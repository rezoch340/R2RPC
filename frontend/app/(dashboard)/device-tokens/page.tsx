import { TokenManagementPage } from '@/components/token-management-page';

export default function DeviceTokensPage() {
  return (
    <TokenManagementPage
      resourcePath="/device-tokens"
      resourceQueryKey="device-tokens"
      permissionSubject="device-token"
      eyebrow="Device authentication"
      title="设备令牌"
      description="设备使用 dk_ 令牌自注册上线，并继承令牌绑定的功能组。"
      createDescription="每类设备使用独立令牌，便于撤销、审计和统计在线设备。"
      showOnlineDevices
    />
  );
}
