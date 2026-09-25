# Pokédex

A Pokémon lookup whose application core runs on Effect, served through React Router as its web adapter.

## Language

### Web adapter

**Bridge**:
The single point where a route's loader or action hands an Effect program to the application core and turns its outcome into a route response.
_Avoid_: adapter layer, glue, runner

**Request scope**:
Everything that identifies one HTTP request while it is handled: the process runtime serving it, its request id, its cancellation, and the trace it belongs to.
_Avoid_: request context (collides with React Router's router context), request info
