export type MutationResult<T extends object = object> =
  { status: 'notFound' } | ({ status: 'ok' } & T);
