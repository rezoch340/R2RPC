import { TokenManagementPage } from '@/components/token-management-page';

export default function AccessTokensPage() {
  return (
    <TokenManagementPage
      resourcePath="/access-tokens"
      resourceQueryKey="access-tokens"
      permissionSubject="access-token"
      eyebrow="Caller authentication"
      title="访问令牌"
      description="调用方使用 rk_ 令牌访问已授权功能组的 RPC 能力。"
      createDescription="令牌明文会保存在后台并可随时回看；请按调用方拆分令牌。"
    />
  );
}
