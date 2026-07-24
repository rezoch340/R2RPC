export const DEVICE_TOKEN_SCOPE_CHANGED_CHANNEL =
  'ws:device-token-scope-changed';

export interface DeviceTokenScopeChangedEvent {
  deviceTokenId: number;
}
