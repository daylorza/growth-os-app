/** Query parameter the analyst's MCP connector uses for its key. */
export const KEY_PARAM = 'key'

/**
 * Builds the upstream query string and Authorization header for a pass-through request.
 * `key` is always removed from the URL so it never reaches the API, its logs or an error message.
 * On /mcp only (`allowQueryKey`), a `?key=` value becomes a Bearer credential when no Authorization header is sent.
 * The API still decides what the key may do (the connector key only works on /mcp, with the analyst role).
 */
export function connectorAuth(search: string, authorization: string | null, allowQueryKey: boolean): { search: string; authorization: string | null; fromQuery: boolean } {
  const params = new URLSearchParams(search)
  const key = params.get(KEY_PARAM)?.trim()
  params.delete(KEY_PARAM)
  const rest = params.toString()
  const fromQuery = !authorization && allowQueryKey && !!key
  return { search: rest ? `?${rest}` : '', authorization: authorization || (fromQuery ? `Bearer ${key}` : null), fromQuery }
}

/** Tells the API the credential came from the URL, so it accepts only the connector key there. */
export const KEY_SOURCE_HEADER = 'x-growth-key-source'
