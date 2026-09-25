/**
 * Plain, serializable shapes and helpers that components use on both server
 * and client. No Effect, no branded types, no classes. The view DTOs
 * themselves are derived from their encoders in `view.server.ts`.
 */

export interface SearchState {
  readonly value: string;
  readonly error: string | null;
}

/** What a visitor sees for a route error: produced by `view.server.ts`, rendered by an ErrorBoundary. */
export interface ErrorPresentation {
  readonly title: string;
  readonly message: string;
}

/** The presentation carried by a route error response, or a generic one for anything else. */
export const errorPresentationOf = (error: {
  readonly status: number;
  readonly statusText: string;
  readonly data: unknown;
}): ErrorPresentation => {
  const { data } = error;

  if (typeof data === 'object' && data !== null && 'title' in data && 'message' in data) {
    return { title: String(data.title), message: String(data.message) };
  }

  return { title: `Error ${error.status}`, message: error.statusText };
};

export const formatDexNumber = (dexNumber: number) => {
  return `#${String(dexNumber).padStart(4, '0')}`;
};
