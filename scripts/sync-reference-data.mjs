// scripts/sync-reference-data.mjs
// Email Your MP / Campaign Intelligence Platform
// Purpose: Sync canonical political reference data from GitHub into Supabase.
//
// Sources:
// - MP lookup: api/data/emails.json
// - MP intelligence: api/data/mp-intelligence-2024.json
//
// Run locally:
//   node scripts/sync-reference-data.mjs
//
// Required environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   MP_LOOKUP_URL
//   MP_INTELLIGENCE_URL

import 'dotenv/config';
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MP_LOOKUP_URL =
  process.env.MP_LOOKUP_URL ||
  "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/refs/heads/main/api/data/emails.json";

const MP_INTELLIGENCE_URL =
  process.env.MP_INTELLIGENCE_URL ||
  "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/refs/heads/main/api/data/mp-intelligence-2024.json";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.");
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

function cleanInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/%/g, "").replace(/,/g, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFirstPresent(obj, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": "email-your-mp-reference-sync/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse JSON from ${url}: ${error.message}`);
  }
}

function normaliseArray(json) {
  if (Array.isArray(json)) return json;

  // Supports common wrapper formats such as { data: [...] }, { records: [...] }, { mps: [...] }.
  for (const key of ["data", "records", "mps", "items", "constituencies", "results"]) {
    if (Array.isArray(json?.[key])) return json[key];
  }

  throw new Error("Expected JSON array or an object containing a recognised array key.");
}

function mapMpDirectoryRecord(record) {
  const mpEmail = cleanEmail(
    getFirstPresent(record, [
      "mp_email",
      "email",
      "Email",
      "MP Email",
      "MP_Email",
      "mpEmail",
      "MP email",
    ])
  );

  const mpName = cleanString(
    getFirstPresent(record, [
      "mp_name",
      "name",
      "Name",
      "MP",
      "mp",
      "MP Name",
      "member_name",
    ])
  );

  const party = cleanString(
    getFirstPresent(record, [
      "party",
      "Party",
      "party_name",
      "Party name",
    ])
  );

  const constituency = cleanString(
    getFirstPresent(record, [
      "constituency",
      "Constituency",
      "constituency_name",
      "Constituency name",
      "seat",
      "Seat",
    ])
  );

  if (!mpEmail) return null;

  return {
    mp_email: mpEmail,
    mp_name: mpName,
    party,
    constituency,
    source: "github_mp_lookup",
    source_updated_at: new Date().toISOString(),
    raw_source_json: record,
  };
}

function mapMpIntelligenceRecord(record) {
  const constituency = cleanString(
    getFirstPresent(record, [
      "constituency",
      "Constituency",
      "constituency_name",
      "Constituency name",
      "seat",
      "Seat",
    ])
  );

  if (!constituency) return null;

  const mpName = cleanString(
    getFirstPresent(record, [
      "mp_name",
      "MP name",
      "MP Name",
      "mp",
      "MP",
      "member_name",
      "name",
      "Name",
    ])
  );

  const party = cleanString(
    getFirstPresent(record, [
      "party",
      "Party",
      "first_party",
      "First party",
      "winning_party",
      "Winning party",
    ])
  );

  const runnerUpParty = cleanString(
    getFirstPresent(record, [
      "runner_up_party",
      "Runner-up party",
      "Runner up party",
      "second_party",
      "Second party",
    ])
  );

  const majority = cleanInteger(
    getFirstPresent(record, [
      "majority",
      "Majority",
      "maj",
      "Maj",
    ])
  );

  const majorityPct = cleanNumber(
    getFirstPresent(record, [
      "majority_pct",
      "Majority %",
      "majority_percentage",
      "Majority percentage",
    ])
  );

  const voteSharePct = cleanNumber(
    getFirstPresent(record, [
      "vote_share_pct",
      "Vote share %",
      "winner_vote_share_pct",
      "Winning vote share %",
    ])
  );

  const electionYear = cleanInteger(
    getFirstPresent(record, [
      "election_year",
      "Election year",
      "year",
      "Year",
    ])
  ) || 2024;

  return {
    constituency,
    mp_name: mpName,
    party,
    majority,
    majority_pct: majorityPct,
    vote_share_pct: voteSharePct,
    runner_up_party: runnerUpParty,
    election_year: electionYear,
    region: cleanString(getFirstPresent(record, ["region", "Region"])),
    nation: cleanString(getFirstPresent(record, ["nation", "Nation", "country", "Country"])),
    seat_type: cleanString(getFirstPresent(record, ["seat_type", "Seat type"])),
    marginality_band: cleanString(getFirstPresent(record, ["marginality_band", "Marginality band"])),
    strategic_priority: cleanString(getFirstPresent(record, ["strategic_priority", "Strategic priority"])),
    source: "mp_intelligence_file",
    raw_source_json: record,
  };
}

async function upsertInBatches({ table, rows, conflictColumn, batchSize = 250 }) {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictColumn });

    if (error) {
      failed += batch.length;
      console.error(`Failed batch for ${table}:`, error.message);
      throw error;
    }

    processed += batch.length;
    console.log(`${table}: upserted ${processed}/${rows.length}`);
  }

  return { processed, failed };
}

async function syncMpDirectory() {
  console.log("Fetching MP lookup data...");
  const json = await fetchJson(MP_LOOKUP_URL);
  const records = normaliseArray(json);

  const rows = records
    .map(mapMpDirectoryRecord)
    .filter(Boolean);

  const uniqueRows = Array.from(
    new Map(rows.map((row) => [row.mp_email, row])).values()
  );

  console.log(`MP directory: ${records.length} source records, ${uniqueRows.length} valid unique rows.`);

  return upsertInBatches({
    table: "mp_directory",
    rows: uniqueRows,
    conflictColumn: "mp_email",
  });
}

async function syncMpIntelligence() {
  console.log("Fetching MP intelligence data...");
  const json = await fetchJson(MP_INTELLIGENCE_URL);
  const records = normaliseArray(json);

  const rows = records
    .map(mapMpIntelligenceRecord)
    .filter(Boolean);

  const uniqueRows = Array.from(
    new Map(rows.map((row) => [`${row.constituency}::${row.election_year}`, row])).values()
  );

  console.log(`MP intelligence: ${records.length} source records, ${uniqueRows.length} valid unique rows.`);

  return upsertInBatches({
    table: "mp_intelligence",
    rows: uniqueRows,
    conflictColumn: "constituency,election_year",
  });
}

async function main() {
  const startedAt = new Date();
  console.log(`Reference data sync started at ${startedAt.toISOString()}`);

  const mpDirectoryResult = await syncMpDirectory();
  const mpIntelligenceResult = await syncMpIntelligence();

  const finishedAt = new Date();
  console.log("Reference data sync complete.");
  console.log({
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    mp_directory: mpDirectoryResult,
    mp_intelligence: mpIntelligenceResult,
  });
}

main().catch((error) => {
  console.error("Reference data sync failed:", error);
  process.exit(1);
});
