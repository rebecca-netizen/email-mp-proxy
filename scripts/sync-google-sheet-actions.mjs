// scripts/sync-google-sheet-actions.mjs
// Imports Email Your MP actions from Google Apps Script export endpoint into Supabase

import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_APPS_SCRIPT_EXPORT_URL =
  process.env.GOOGLE_APPS_SCRIPT_EXPORT_URL;

const GOOGLE_APPS_SCRIPT_EXPORT_TOKEN =
  process.env.GOOGLE_APPS_SCRIPT_EXPORT_TOKEN;

const IMPORT_CUTOFF_DATE =
  process.env.IMPORT_CUTOFF_DATE || '2026-02-24';

const IMPORT_CUTOFF = new Date(
  `${IMPORT_CUTOFF_DATE}T00:00:00.000Z`
);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'
  );
  process.exit(1);
}

if (
  !GOOGLE_APPS_SCRIPT_EXPORT_URL ||
  !GOOGLE_APPS_SCRIPT_EXPORT_TOKEN
) {
  console.error(
    'Missing GOOGLE_APPS_SCRIPT_EXPORT_URL or GOOGLE_APPS_SCRIPT_EXPORT_TOKEN.'
  );
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned.length ? cleaned : null;
}

function cleanEmail(value) {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

function normaliseKey(value) {
  return cleanString(value)?.toLowerCase() || null;
}

function parseBooleanish(value) {
  const cleaned = cleanString(value)?.toLowerCase();

  if (!cleaned) return null;

  if (
    ['true', 'yes', 'y', '1', 'consented'].includes(cleaned)
  ) {
    return 'true';
  }

  if (
    ['false', 'no', 'n', '0', 'declined'].includes(cleaned)
  ) {
    return 'false';
  }

  return cleaned;
}

function makeHash(parts) {
  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex');
}

async function fetchRows() {
  const url =
    `${GOOGLE_APPS_SCRIPT_EXPORT_URL}` +
    `?action=export-clicks` +
    `&token=${encodeURIComponent(
      GOOGLE_APPS_SCRIPT_EXPORT_TOKEN
    )}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Export endpoint failed: ${response.status}`
    );
  }

  const json = await response.json();

  if (!json.ok) {
    throw new Error(
      json.error || 'Unknown export endpoint error'
    );
  }

  return json.rows || [];
}

async function createIngestionRun() {
  const { data, error } = await supabase
    .from('ingestion_runs')
    .insert({
      source_system: 'google_sheet_clicks',
      status: 'running',
    })
    .select('id')
    .single();

  if (error) throw error;

  return data.id;
}

async function finishIngestionRun(id, payload) {
  await supabase
    .from('ingestion_runs')
    .update({
      finished_at: new Date().toISOString(),
      ...payload,
    })
    .eq('id', id);
}

async function loadCampaignRules() {
  const { data, error } = await supabase
    .from('campaign_matching_rules')
    .select('*')
    .eq('active', true);

  if (error) throw error;

  return data || [];
}

function inferCampaignId(action, rules) {
  for (const rule of rules) {
    const fieldValue =
      normaliseKey(action[rule.match_field]) || '';

    const matchValue =
      normaliseKey(rule.match_value) || '';

    let matched = false;

    if (rule.match_type === 'equals') {
      matched = fieldValue === matchValue;
    }

    if (rule.match_type === 'contains') {
      matched = fieldValue.includes(matchValue);
    }

    if (rule.match_type === 'starts_with') {
      matched = fieldValue.startsWith(matchValue);
    }

    if (matched) {
      return rule.campaign_id;
    }
  }

  return null;
}

async function upsertSupporter({
  email,
  timestamp,
  postcode,
  constituency,
  consent,
  agConsent,
}) {
  const supporterEmail = cleanEmail(email);

  if (!supporterEmail) return null;

  const { data: existing } = await supabase
    .from('supporters')
    .select('id')
    .eq('email_normalised', supporterEmail)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('supporters')
      .update({
        last_seen_at: timestamp,
        latest_postcode: postcode,
        latest_constituency: constituency,
        consent_status: parseBooleanish(consent),
        ag_consent_status: parseBooleanish(agConsent),
      })
      .eq('id', existing.id);

    return existing.id;
  }

  const { data, error } = await supabase
    .from('supporters')
    .insert({
      email: supporterEmail,
      first_seen_at: timestamp,
      last_seen_at: timestamp,
      latest_postcode: postcode,
      latest_constituency: constituency,
      consent_status: parseBooleanish(consent),
      ag_consent_status: parseBooleanish(agConsent),
    })
    .select('id')
    .single();

  if (error) throw error;

  return data.id;
}

async function main() {
  const ingestionRunId = await createIngestionRun();

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  try {
    console.log(
      'Google Sheet Apps Script sync started...'
    );

    const rows = await fetchRows();

    console.log(`Rows returned: ${rows.length}`);

    const campaignRules = await loadCampaignRules();

    for (const row of rows) {
      try {
        const timestamp = new Date(row.Timestamp);

        if (timestamp < IMPORT_CUTOFF) {
          skipped += 1;
          continue;
        }

        const event = cleanString(row.Event);

        if (event !== 'mp-email-sent') {
          skipped += 1;
          continue;
        }

        const supporterEmail = cleanEmail(row.UserEmail);

        if (!supporterEmail) {
          skipped += 1;
          continue;
        }

        const sourceHash = makeHash([
          row.Timestamp || '',
          row.Email || '',
          supporterEmail,
          row.Subject || '',
          row.Body || '',
        ]);

        const { data: existing } = await supabase
          .from('mp_email_actions')
          .select('id')
          .eq('source_row_hash', sourceHash)
          .maybeSingle();

        if (existing) {
          skipped += 1;
          continue;
        }

        const campaignId = inferCampaignId(
          {
            subject: row.Subject,
            body: row.Body,
            page: row.Page,
          },
          campaignRules
        );

        const supporterId = await upsertSupporter({
          email: supporterEmail,
          timestamp: timestamp.toISOString(),
          postcode: row.Postcode,
          constituency: row.Constituency,
          consent: row.Consent,
          agConsent: row.AG_Consent,
        });

        const { error } = await supabase
          .from('mp_email_actions')
          .insert({
            source_system: 'google_sheet_clicks',
            source_timestamp: timestamp.toISOString(),
            source_row_hash: sourceHash,

            supporter_id: supporterId,
            campaign_id: campaignId,

            event: row.Event,
            supporter_email: supporterEmail,
            mp_email: cleanEmail(row.Email),

            subject: row.Subject,
            body: row.Body,

            page: row.Page,
            user_agent: row.UserAgent,
            ip_address: row.IP,

            consent: row.Consent,
            ag_consent: row.AG_Consent,

            raw_mp_name: row.MP,
            raw_constituency: row.Constituency,
            raw_postcode: row.Postcode,

            raw_row_json: row,
          });

        if (error) {
          throw error;
        }

        imported += 1;
      } catch (err) {
        failed += 1;
        console.error(err.message);
      }
    }

    console.log(
      `Complete. Imported: ${imported}, skipped: ${skipped}, failed: ${failed}`
    );

    await finishIngestionRun(ingestionRunId, {
      status: 'complete',
      rows_imported: imported,
      rows_skipped: skipped,
      rows_failed: failed,
    });
  } catch (err) {
    console.error(err);

    await finishIngestionRun(ingestionRunId, {
      status: 'failed',
      error_summary: err.message,
    });

    process.exit(1);
  }
}

main();
