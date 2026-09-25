import { Context } from 'effect';

/** Request-scoped metadata, provided per request by the web adapter. */
export class CurrentRequest extends Context.Service<
  CurrentRequest,
  {
    readonly requestId: string;
  }
>()('app/application/CurrentRequest') {}
