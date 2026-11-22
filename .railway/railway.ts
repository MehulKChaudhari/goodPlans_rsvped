import { defineRailway, postgres, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Redis = redis("Redis", { region: "europe-west4-drams3a" });
  Redis.deploy = { multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 1 } }, startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.deploy = { multiRegionConfig: { "europe-west4-drams3a": { numReplicas: 1 } } };
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const worker = service("worker", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "europe-west4-drams3a": 1 },
    deploy: {
      startCommand: "pnpm run worker:start",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
  });
  const web = service("web", {
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "europe-west4-drams3a": 1 },
    deploy: {
      startCommand: "pnpm run db:deploy && pnpm run start",
      healthcheckPath: "/health",
      healthcheckTimeout: 30,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
  });

  return project("goodplans-rsvped", {
    variables: { managed: false },
    resources: [Redis, worker, Postgres, web, redisVolume, postgresVolume],
  });
});
