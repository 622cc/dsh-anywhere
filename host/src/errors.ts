export const ERROR_DEFINITIONS = {
  unauthorized: { status: 401, message: 'Device authorization or pairing offer is invalid.', retryable: false },
  forbidden: { status: 403, message: 'This operation is not permitted.', retryable: false },
  not_found: { status: 404, message: 'The requested resource was not found.', retryable: false },
  invalid_request: { status: 400, message: 'The request is invalid.', retryable: false },
  payload_too_large: { status: 413, message: 'The request exceeds the allowed size.', retryable: false },
  unsupported_media_type: { status: 415, message: 'Use UTF-8 application/json.', retryable: false },
  question_expired: { status: 409, message: 'The question was already answered or is no longer available.', retryable: false },
  conflict: { status: 409, message: 'The request identity conflicts with an existing operation.', retryable: false },
  rate_limited: { status: 429, message: 'Too many requests. Try again later.', retryable: true },
  unavailable: { status: 503, message: 'The host is temporarily unavailable.', retryable: true },
  internal_error: { status: 500, message: 'The host could not complete this request.', retryable: false },
  invalid_config: { status: 500, message: 'Local host configuration is invalid.', retryable: false },
  unsupported_dsh_version: { status: 500, message: 'Supported DSH versions: 0.2.0-rc.2 and every 0.2.1 release or pre-release. Check dsh --version before declaring dshVersion.', retryable: false },
  openssl_required: { status: 500, message: 'OpenSSL 3 is required for X.509 generation. Install a trusted copy or supply --openssl <absolute executable>.', retryable: false },
  unsafe_private_path: { status: 500, message: 'Use an owner-only local directory outside Git, with no redirected ancestors. Existing weak ACLs are not repaired.', retryable: false },
  invitation_output_exists: { status: 409, message: 'That invitation file already exists. Delete the old one-use file or choose a new name; no pairing window was opened.', retryable: false },
  qr_too_large: { status: 400, message: 'Invitation does not fit a QR at error correction M. Use the private JSON output file; nothing is truncated.', retryable: false },
  invitation_output_required: { status: 400, message: 'Choose --qr and/or --output <private-invitations/file.json> explicitly before pairing; remote-pair requires --output. Invitation JSON is never printed to stdout.', retryable: false },
  workspace_registry_unavailable: { status: 503, message: 'DSH workspace registry is unavailable; registry mode cannot start or serve workspaces.', retryable: true },
  tailcat_helper_missing: { status: 500, message: 'The Tailcat helper for this platform is missing. Build it with tools/build-tailcat.sh, rebuild the host and reinstall.', retryable: false },
  tailcat_unavailable: { status: 503, message: 'The running companion did not open a Tailcat pairing window. Start DSH with the companion enabled (tailcat-status shows its state) and retry.', retryable: true },
  local_pairing_unavailable: { status: 400, message: 'Same-Wi-Fi pairing needs macOS Bonjour (dns-sd) and a Wi-Fi/LAN connection. Use --qr or --output instead.', retryable: false },
  pairing_not_approved: { status: 400, message: 'No phone was approved before the pairing window closed. Nothing was paired.', retryable: false },
  companion_conflict: { status: 500, message: 'This DSH profile already runs the companion installed by tools/install-host.mjs. Remove it with "node tools/install-host.mjs --uninstall", then restart DSH.', retryable: false },
  explicit_grants_unavailable: { status: 400, message: 'Explicit workspace IDs are only supported in explicit-list mode; use all in registry mode.', retryable: false },
} as const;
export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

/** Only these fixed, credential/path-free messages cross the mobile boundary. */
export class HostError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: ErrorCode) {
    super(ERROR_DEFINITIONS[code].message);
    this.name = 'HostError';
    this.code = code;
    this.status = ERROR_DEFINITIONS[code].status;
    this.retryable = ERROR_DEFINITIONS[code].retryable;
  }
}

export function publicError(error: unknown): HostError {
  return error instanceof HostError ? error : new HostError('internal_error');
}
export function errorEnvelope(error: unknown) {
  const safe = publicError(error);
  return { error: { code: safe.code, message: safe.message, retryable: safe.retryable } };
}
