/**
 * SAMPLE-DATA SEAM (v1.3 UI day, FR-43) — Releases page extras the API does not serve yet.
 * Copied from the AdminReleases board. The release list, publish, required/optional, withdraw/restore,
 * reach and adoption all come from the real API (`admin/releases/*`); only these blocks are sample:
 *
 *  - AGENT_VERSIONS_IN_USE: PCs per agent version (needs a per-version count from heartbeats).
 *  - MIN_AGENT_VERSION / MIN_VERSION_OPTIONS: the minimum agent version setting (no field/endpoint yet).
 *  - SIGNER: the signing certificate shown on the current release and the new-release check (not stored).
 *
 * API day: add `GET admin/releases/versions/` (per-version PCs), a `min_version` setting and the signer
 * thumbprint on each release, then delete this file.
 */

export interface VersionInUse {
  /** "1.2.1", or a range label like "1.1.x". */
  label: string;
  /** Lowest exact version in the bucket (for "Below minimum"). */
  lowest: string;
  pcs: number;
  colour: string;
  note: string;
}

export const AGENT_VERSIONS_IN_USE: VersionInUse[] = [
  { label: "1.2.1", lowest: "1.2.1", pcs: 12, colour: "#16181B", note: "" },
  { label: "1.2.0", lowest: "1.2.0", pcs: 196, colour: "#5E6167", note: "" },
  { label: "1.1.x", lowest: "1.1.2", pcs: 5, colour: "#A9ADB3", note: "offline since before 23 Oct" },
  { label: "1.0.4", lowest: "1.0.4", pcs: 1, colour: "#A3260F", note: "last seen 19 Aug" },
];

/** Exact versions behind the buckets above (for "N PCs below the minimum"). */
export const AGENT_VERSIONS_EXACT: [string, number][] = [
  ["1.2.1", 12],
  ["1.2.0", 196],
  ["1.1.3", 3],
  ["1.1.2", 2],
  ["1.0.4", 1],
];

export const MIN_VERSION_OPTIONS = ["1.0.4", "1.1.0", "1.1.2", "1.1.3", "1.2.0", "1.2.1"];
export const MIN_AGENT_VERSION = "1.1.0";

export const SIGNER = {
  name: "Zinwe dev certificate",
  thumbprint: "4A1F 9C07 … 3BC2",
  pending: "Self-signed — OV certificate pending",
};
