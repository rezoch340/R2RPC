import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

function readAllowedDevelopmentOrigins(): string[] {
  const configuredOrigins = (
    process.env.NEXT_ALLOWED_DEV_ORIGINS ?? ""
  )
    .split(",")
    .map((configuredOrigin) => configuredOrigin.trim())
    .filter(Boolean);
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
