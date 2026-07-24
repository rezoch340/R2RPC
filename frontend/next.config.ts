import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { parse } from "yaml";

function readConfiguredDevelopmentOrigins(): string[] {
  if (process.env.NODE_ENV === "production") {
    return [];
  }
  const configurationFile = process.env.CONFIG_FILE ?? "../config.yaml";
  if (!existsSync(configurationFile)) {
    return [];
  }
  const configurationSource: unknown = parse(
    readFileSync(configurationFile, "utf8"),
  );
  if (!configurationSource || typeof configurationSource !== "object") {
    return [];
  }
  const frontendConfiguration = (
    configurationSource as {
      frontend?: { allowedDevOrigins?: unknown };
    }
  ).frontend;
  return Array.isArray(frontendConfiguration?.allowedDevOrigins)
    ? frontendConfiguration.allowedDevOrigins.filter(
        (configuredOrigin): configuredOrigin is string =>
          typeof configuredOrigin === "string" && configuredOrigin.length > 0,
      )
    : [];
}

function readAllowedDevelopmentOrigins(): string[] {
  const configuredOrigins = readConfiguredDevelopmentOrigins();
  const localNetworkAddresses = Object.values(networkInterfaces())
    .flatMap((interfaceAddresses) => interfaceAddresses ?? [])
    .filter(
      (interfaceAddress) =>
        interfaceAddress.family === "IPv4" && !interfaceAddress.internal,
    )
    .map((interfaceAddress) => interfaceAddress.address);

  return Array.from(
    new Set([
      "127.0.0.1",
      "localhost",
      ...localNetworkAddresses,
      ...configuredOrigins,
    ]),
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: readAllowedDevelopmentOrigins(),
};

export default nextConfig;
