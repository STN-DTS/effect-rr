import { Config, Duration } from 'effect';

export const ServerConfig = Config.all({
  host: Config.String('HOST').pipe(Config.withDefault('0.0.0.0')),
  port: Config.Port('PORT').pipe(Config.withDefault(3000)),
  /** How long in-flight requests get to finish on SIGTERM before we force-close. */
  shutdownTimeout: Config.Duration('SHUTDOWN_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
});
