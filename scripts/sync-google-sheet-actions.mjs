// scripts/sync-google-sheet-actions.mjs
// Email Your MP / Campaign Intelligence Platform
// Purpose: Import canonical Google Sheet action rows into Supabase, enrich with MP directory + election intelligence, and preserve raw data.
//
// Source:
// - Google Sheet: Clicks tab
// - Canonical rows: Event = 'mp-email-sent'
// - Cut-off: Timestamp >= 2026-02-24
//
// Required environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID
//   GOOGLE_SHEET_NAME
//
// Optional environment variables:
//   IMPORT_CUTOFF_DATE=2026-02-24
//
// Install dependencies:
//   npm install @supabase/supabase-js googleapis dotenv
//
// Run locally:
//   node scripts/sync-google-sheet-actions.mjs

import 'dotenv/config';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Clicks';

const IMPORT_CUTOFF_DATE = process.env.IMPORT_CUTOFF_DATE || '2026-02-24';
const IMPORT_CUTOFF = new Date(`${IMPORT_CUTOFF_DATE}T00:00:00.000Z`);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
  console.error('Missing Google Sheets environment variables. Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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
  if (['true', 'yes', 'y', '1', 'consented', 'agree', 'agreed'].includes(cleaned)) return 'true';
  if (['false', 'no', 'n', '0', 'declined'].includes(cleaned)) return 'false';
  return cleanString(value);
}

function parseSheetTimestamp(value) {
  const raw = cleanString(value);
  if (!raw) return null;

  // Google Sheets often returns ISO-ish or locale strings depending on formatting.
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  // UK-style fallback: DD/MM/YYYY HH:mm:ss or DD/MM/YYYY HH:mm
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = match;
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${min}:${ss.padStart(2, '0')}.000Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function makeHash(parts) {
  return crypto
    .createHash('sha256')
    .update(parts.map((part) => cleanString(part) || '').join('|'))
    .digest('hex');
}

function mapHeaders(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const key = cleanString(header);
    if (key) map.set(key, index);
  });
  return map;
}

function getCell(row, headerMap, header) {
  const index = headerMap.get(header);
  if (index === undefined) return null;
  return cleanString(row[index]);
}

function rowToObject(row, headerMap) {
  const obj = {};
  for (const [header, index] of headerMap.entries()) {
    obj[header] = row[index] ?? null;
  }
  return obj;
}

function inferCampaignId(action, campaignRules) {
  const candidates = [];

  for (const rule of campaignRules) {
    if (!rule.active) continue;

    const fieldValue = normaliseKey(action[rule.match_field]);
    const matchValue = normaliseKey(rule.match_value);

    if (!fieldValue || !matchValue) continue;

    let matched = false;
    if (rule.match_type === 'equals') matched = fieldValue === matchValue;
    if (rule.match_type === 'contains') matched = fieldValue.includes(matchValue);
    if (rule.match_type === 'starts_with') matched = fieldValue.startsWith(matchValue);

    if (matched) {
      candidates.push(rule);
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return candidates[0].campaign_id;
}

async function createIngestionRun() {
  const { data, error } = await supabase
    .from('ingestion_runs')
    .insert({
      source_system: 'google_sheet_clicks',
      status: 'running',
      notes: `Google Sheet action import from ${GOOGLE_SHEET_NAME}; cutoff ${IMPORT_CUTOFF_DATE}`,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function finishIngestionRun(id, payload) {
  const { error } = await supabase
    .from('ingestion_runs')
    .update({
      finished_at: new Date().toISOString(),
      ...payload,
    })
    .eq('id', id);

  if (error) console.error('Failed to update ingestion run:', error.message);
}

async function readGoogleSheetRows() {
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${GOOGLE_SHEET_NAME}!A:Z`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  return response.data.values || [];
}

async function loadCampaignRules() {
  const { data, error } = await supabase
    .from('campaign_matching_rules')
    .select('campaign_id, match_field, match_type, match_value, priority, active')
    .eq('active', true)
    .order('priority', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function findMpDirectoryByEmail(mpEmail) {
  if (!mpEmail) return null;

  const { data, error } = await supabase
    .from('mp_directory')
    .select('id, mp_email, mp_name, party, constituency')
    .eq('mp_email_normalised', mpEmail.toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findMpIntelligenceByConstituency(constituency) {
  if (!constituency) return null;

  const { data, error } = await supabase
    .from('mp_intelligence')
    .select('id, constituency, mp_name, party, majority, majority_pct, region, nation, marginality_band')
    .eq('constituency', constituency)
    .eq('election_year', 2024)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function upsertSupporter({ email, timestamp, postcode, constituency, consent, agConsent }) {
  const supporterEmail = cleanEmail(email);
  if (!supporterEmail) return null;

  const payload = {
    email: supporterEmail,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    latest_postcode: postcode,
    latest_constituency: constituency,
    consent_status: parseBooleanish(consent),
    ag_consent_status: parseBooleanish(agConsent),
  };

  const { data: existing, error: existingError } = await supabase
    .from('supporters')
    .select('id, first_seen_at, last_seen_at')
    .eq('email_normalised', supporterEmail)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing) {
    const existingFirst = existing.first_seen_at ? new Date(existing.first_seen_at) : null;
    const newTimestamp = timestamp ? new Date(timestamp) : null;

    const updatePayload = {
      last_seen_at: timestamp,
      latest_postcode: postcode,
      latest_constituency: constituency,
      consent_status: parseBooleanish(consent),
      ag_consent_status: parseBooleanish(agConsent),
    };

    if (newTimestamp && (!existingFirst || newTimestamp < existingFirst)) {
      updatePayload.first_seen_at = timestamp;
    }

    const { data, error } = await supabase
      .from('supporters')
      .update(updatePayload)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  const { data, error } = await supabase
    .from('supporters')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function insertAction(action) {
  const { error } = await supabase
    .from('mp_email_actions')
    .insert(action);

  if (error) {
    // Duplicate row hashes are expected on repeated syncs.
    if (error.code === '23505') {
      return { inserted: false, duplicate: true };
    }
    throw error;
  }

  return { inserted: true, duplicate: false };
}

async function main() {
  const startedAt = new Date();
  const ingestionRunId = await createIngestionRun();

  let rowsSeen = 0;
  let rowsImported = 0;
  let rowsSkipped = 0;
  let rowsFailed = 0;
  const skipReasons = new Map();

  function skip(reason) {
    rowsSkipped += 1;
    skipReasons.set(reason, (skipReasons.get(reason) || 0) + 1);
  }

  try {
    console.log(`Google Sheet action sync started at ${startedAt.toISOString()}`);
    console.log(`Reading sheet ${GOOGLE_SHEET_ID} / tab ${GOOGLE_SHEET_NAME}`);

    const values = await readGoogleSheetRows();
    if (values.length < 2) throw new Error('Sheet has no data rows.');

    const headers = values[0];
    const headerMap = mapHeaders(headers);
    const dataRows = values.slice(1);
    const campaignRules = await loadCampaignRules();

    console.log(`Rows found excluding header: ${dataRows.length}`);
    console.log(`Campaign matching rules loaded: ${campaignRules.length}`);

    for (let i = 0; i < dataRows.length; i += 1) {
      const row = dataRows[i];
      const sourceRowNumber = i + 2;
      rowsSeen += 1;

      try {
        const timestampRaw = getCell(row, headerMap, 'Timestamp');
        const timestamp = parseSheetTimestamp(timestampRaw);
        const event = getCell(row, headerMap, 'Event');
        const mpEmail = cleanEmail(getCell(row, headerMap, 'Email'));
        const supporterEmail = cleanEmail(getCell(row, headerMap, 'UserEmail'));
        const subject = getCell(row, headerMap, 'Subject');
        const body = getCell(row, headerMap, 'Body');
        const rawMpName = getCell(row, headerMap, 'MP');
        const rawConstituency = getCell(row, headerMap, 'Constituency');
        const rawPostcode = getCell(row, headerMap, 'Postcode');
        const page = getCell(row, headerMap, 'Page');
        const userAgent = getCell(row, headerMap, 'UserAgent');
        const ipAddress = getCell(row, headerMap, 'IP');
        const consent = getCell(row, headerMap, 'Consent');
        const agConsent = getCell(row, headerMap, 'AG_Consent');

        if (!timestamp) {
          skip('invalid_or_missing_timestamp');
          continue;
        }

        if (timestamp < IMPORT_CUTOFF) {
          skip('before_cutoff');
          continue;
        }

        if (event !== 'mp-email-sent') {
          skip('not_mp_email_sent');
          continue;
        }

        if (!mpEmail || !supporterEmail || !subject || !body) {
          skip('missing_required_fields');
          continue;
        }

        const mpDirectory = await findMpDirectoryByEmail(mpEmail);
        const constituencyForLookup = mpDirectory?.constituency || rawConstituency || null;
        const mpIntelligence = await findMpIntelligenceByConstituency(constituencyForLookup);

        const enrichedConstituency = mpDirectory?.constituency || mpIntelligence?.constituency || rawConstituency || null;
        const enrichedMpName = mpDirectory?.mp_name || mpIntelligence?.mp_name || rawMpName || null;
        const enrichedParty = mpDirectory?.party || mpIntelligence?.party || null;

        const campaignId = inferCampaignId(
          {
            subject,
            page,
            body,
          },
          campaignRules
        );

        const supporterId = await upsertSupporter({
          email: supporterEmail,
          timestamp: timestamp.toISOString(),
          postcode: rawPostcode,
          constituency: enrichedConstituency,
          consent,
          agConsent,
        });

        const sourceRowHash = makeHash([
          timestamp.toISOString(),
          event,
          mpEmail,
          supporterEmail,
          subject,
          body,
          sourceRowNumber,
        ]);

        const action = {
          source_system: 'google_sheet_clicks',
          source_sheet_name: GOOGLE_SHEET_NAME,
          source_row_number: sourceRowNumber,
          source_row_hash: sourceRowHash,
          source_timestamp: timestamp.toISOString(),

          campaign_id: campaignId,
          supporter_id: supporterId,
          mp_directory_id: mpDirectory?.id || null,
          mp_intelligence_id: mpIntelligence?.id || null,

          event,
          supporter_email: supporterEmail,
          mp_email: mpEmail,
          subject,
          body,
          page,
          user_agent: userAgent,
          ip_address: ipAddress,
          consent,
          ag_consent: agConsent,

          raw_mp_name: rawMpName,
          raw_constituency: rawConstituency,
          raw_postcode: rawPostcode,

          enriched_mp_name: enrichedMpName,
          enriched_party: enrichedParty,
          enriched_constituency: enrichedConstituency,
          enriched_postcode: rawPostcode,
          enriched_majority: mpIntelligence?.majority || null,
          enriched_majority_pct: mpIntelligence?.majority_pct || null,
          enriched_region: mpIntelligence?.region || null,
          enriched_nation: mpIntelligence?.nation || null,
          enriched_marginality_band: mpIntelligence?.marginality_band || null,

          raw_row_json: rowToObject(row, headerMap),
        };

        const result = await insertAction(action);
        if (result.inserted) rowsImported += 1;
        else if (result.duplicate) skip('duplicate_source_row_hash');
      } catch (rowError) {
        rowsFailed += 1;
        console.error(`Row ${sourceRowNumber} failed:`, rowError.message);
      }
    }

    const summary = {
      rows_seen: rowsSeen,
      rows_imported: rowsImported,
      rows_skipped: rowsSkipped,
      rows_failed: rowsFailed,
      skip_reasons: Object.fromEntries(skipReasons.entries()),
    };

    console.log('Google Sheet action sync complete.');
    console.log(summary);

    await finishIngestionRun(ingestionRunId, {
      status: 'complete',
      rows_seen: rowsSeen,
      rows_imported: rowsImported,
      rows_skipped: rowsSkipped,
      rows_failed: rowsFailed,
      error_summary: rowsFailed ? `${rowsFailed} rows failed` : null,
      notes: JSON.stringify(summary),
    });
  } catch (error) {
    console.error('Google Sheet action sync failed:', error);
    await finishIngestionRun(ingestionRunId, {
      status: 'failed',
      rows_seen: rowsSeen,
      rows_imported: rowsImported,
      rows_skipped: rowsSkipped,
      rows_failed: rowsFailed,
      error_summary: error.message,
    });
    process.exit(1);
  }
}

main();
