// The backend treats datetimes without an explicit offset as UTC.
export const parseApiInstant = (value: string) =>
  Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
