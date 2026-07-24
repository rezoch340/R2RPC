import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME ?? 'admin';
const password = process.env.E2E_PASSWORD ?? 'admin123456';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('heading', { name: '运行概览' }),
  ).toBeVisible();
});

test('登录和全部管理页面通过公开接口加载', async ({ page }) => {
  const routes = [
    ['/projects', '功能组'],
    ['/devices', '设备'],
    ['/request-logs', '请求日志'],
    ['/device-tokens', '设备令牌'],
    ['/access-tokens', '访问令牌'],
    ['/users', '后台账号'],
    ['/permission-groups', '权限组'],
    ['/system-logs', '系统日志'],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('当前账号没有查看此页面的权限。')).toHaveCount(
      0,
    );
  }
});

test('账号菜单提供本人改密入口', async ({ page }) => {
  await page.getByRole('button', { name: username }).click();
  await page.getByText('修改我的密码').click();
  await expect(
    page.getByRole('heading', { name: '修改我的密码' }),
  ).toBeVisible();
  await expect(page.getByLabel('新密码')).toBeVisible();
});

test('移动端导航可以打开并进入管理页面', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航' }).click();
  const navigationDialog = page.getByRole('dialog');
  await expect(
    navigationDialog.getByText('RER0RPC', { exact: true }),
  ).toBeVisible();
  await navigationDialog.getByRole('link', { name: '系统日志' }).click();
  await expect(page).toHaveURL('/system-logs');
  await expect(
    page.getByRole('heading', { name: '系统日志', exact: true }),
  ).toBeVisible();
});

test('页面切换等待接口预取完成且不闪加载骨架', async ({ page }) => {
  let releaseUsersRequest: (() => void) | undefined;
  let markUsersRequestStarted: (() => void) | undefined;
  const usersRequestStarted = new Promise<void>((resolve) => {
    markUsersRequestStarted = resolve;
  });
  const usersRequestCanContinue = new Promise<void>((resolve) => {
    releaseUsersRequest = resolve;
  });

  await page.route('**/users', async (route) => {
    markUsersRequestStarted?.();
    await usersRequestCanContinue;
    await route.continue();
  });

  await page.getByRole('link', { name: '后台账号' }).click();
  await usersRequestStarted;
  await expect(
    page.getByRole('heading', { name: '运行概览' }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);

  releaseUsersRequest?.();
  await expect(page).toHaveURL('/users');
  await expect(
    page.getByRole('heading', { name: '后台账号', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
});

test('未登录访问受保护页面会跳转登录', async ({ browser }) => {
  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  await isolatedPage.goto('/');
  await expect(isolatedPage).toHaveURL(/\/login$/);
  await isolatedContext.close();
});
