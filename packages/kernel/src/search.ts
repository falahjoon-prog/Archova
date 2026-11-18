/** One row a tool module returns to global search (`search`): the module has already narrowed it to what the caller may open. */
export interface SearchHit {
  /** Internal id; `search` encodes it for the API. */
  id: string;
  /** Human reference such as `RFI-012`. */
  ref: string;
  title: string;
  status: string;
}
