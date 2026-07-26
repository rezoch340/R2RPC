import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME ?? 'admin';
const password = process.env.E2E_PASSWORD ?? 'admin123456';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: '运行概览' })).toBeVisible();
});

test('登录和全部管理页面通过公开接口加载', async ({ page }) => {
  await expect(
    page.getByRole('img', { name: '近 7 天请求趋势折线图' }),
  ).toBeVisible();

  const routes = [
    ['/projects', '功能组'],
    ['/devices', '设备'],
    ['/request-logs', '请求日志'],
    ['/rpc-debugger', '手动 RPC 调试'],
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

test('手动 RPC 调试通过受权限保护的公开接口发起调用', async ({ page }) => {
  await page.goto('/rpc-debugger');
  await expect(
    page.getByRole('heading', { name: '手动 RPC 调试', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('功能组', { exact: true })).toBeVisible();
  await expect(page.getByLabel('目标设备', { exact: true })).toBeVisible();

  await page.getByLabel('Action', { exact: true }).fill('browser-smoke-probe');
  await page.getByLabel('超时秒数', { exact: true }).fill('1');
  await page
    .getByLabel('Payload JSON', { exact: true })
    .fill('{"source":"playwright","probe":true}');
  await page.getByRole('button', { name: '发起调用' }).click();

  await expect(page.getByText('响应结果', { exact: true })).toBeVisible();
  await expect(page.getByText('HTTP', { exact: true })).toBeVisible();

  let releaseRepeatedInvocation: (() => void) | undefined;
  let markRepeatedInvocationStarted: (() => void) | undefined;
  const repeatedInvocationStarted = new Promise<void>((resolve) => {
    markRepeatedInvocationStarted = resolve;
  });
  const repeatedInvocationCanContinue = new Promise<void>((resolve) => {
    releaseRepeatedInvocation = resolve;
  });
  await page.route('**/rpc/debug/invoke/**', async (route) => {
    markRepeatedInvocationStarted?.();
    await repeatedInvocationCanContinue;
    await route.continue();
  });

  const refreshContextButton = page.getByRole('button', {
    name: '刷新上下文',
  });
  const invokeButton = page.getByRole('button', { name: '发起调用' });
  const refreshContextButtonBoxBeforeInvocation =
    await refreshContextButton.boundingBox();
  const invokeButtonBoxBeforeInvocation = await invokeButton.boundingBox();

  await invokeButton.click();
  await repeatedInvocationStarted;
  await expect(page.getByText('响应结果', { exact: true })).toBeVisible();
  await expect(page.getByText('实际请求', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无调用结果', { exact: true })).toHaveCount(0);
  await expect(refreshContextButton).toBeDisabled();
  await expect(invokeButton).toBeDisabled();
  await expect(refreshContextButton).toHaveCSS('opacity', '1');
  await expect(invokeButton).toHaveCSS('opacity', '1');

  const refreshContextButtonBoxDuringInvocation =
    await refreshContextButton.boundingBox();
  const invokeButtonBoxDuringInvocation = await invokeButton.boundingBox();
  expect(refreshContextButtonBoxDuringInvocation).toEqual(
    refreshContextButtonBoxBeforeInvocation,
  );
  expect(invokeButtonBoxDuringInvocation).toEqual(
    invokeButtonBoxBeforeInvocation,
  );

  releaseRepeatedInvocation?.();
  await expect(invokeButton).toBeEnabled();
});

test('全部数据列表提供字段筛选和分页', async ({ page }) => {
  const listPages = [
    { route: '/projects', filters: ['名称', '运行态', '启用状态'], pagers: 1 },
    {
      route: '/devices',
      filters: ['设备编号', '平台', '最后 IP', '状态'],
      pagers: 1,
    },
    {
      route: '/device-tokens',
      filters: ['名称', '功能组', '状态'],
      pagers: 1,
    },
    {
      route: '/access-tokens',
      filters: ['名称', '功能组', '状态'],
      pagers: 1,
    },
    {
      route: '/users',
      filters: ['账号', '展示角色', '状态'],
      pagers: 1,
    },
    {
      route: '/permission-groups',
      filters: ['权限组', '所含权限', '动作', '资源'],
      pagers: 2,
    },
    {
      route: '/request-logs',
      filters: ['功能组', '动作', '设备编号', '载荷索引'],
      pagers: 1,
    },
    {
      route: '/system-logs',
      filters: ['事件', '操作者', '动作', '资源', '目标类型', '目标名称'],
      pagers: 1,
    },
  ] as const;

  for (const listPage of listPages) {
    await page.goto(listPage.route);
    for (const filterLabel of listPage.filters) {
      await expect(
        page.getByLabel(filterLabel, { exact: true }).first(),
      ).toBeVisible();
    }
    const pageSizeSelectors = page.getByLabel('每页条数');
    await expect(pageSizeSelectors).toHaveCount(listPage.pagers);
    for (
      let selectorIndex = 0;
      selectorIndex < listPage.pagers;
      selectorIndex += 1
    ) {
      await expect(pageSizeSelectors.nth(selectorIndex)).toContainText(
        '10 条/页',
      );
    }
  }
});

test('分页器支持页码、每页上限和跳页', async ({ page }) => {
  await page.goto('/system-logs');
  await expect(page.getByText(/第 1-10 条 \/ 共 \d+ 条/)).toBeVisible();
  await expect(page.getByRole('button', { name: '第 2 页' })).toBeVisible();
  await expect(page.getByLabel('跳转页码')).toBeVisible();

  await page.getByLabel('每页条数').click();
  await expect(page.getByRole('option', { name: '100 条/页' })).toBeVisible();
  await expect(page.getByRole('option', { name: '200 条/页' })).toHaveCount(0);
});

test('系统日志长事件描述不会覆盖其他列', async ({ page }) => {
  await page.goto('/system-logs');
  const firstSystemLogRow = page
    .locator('[data-slot="table-body"] [data-slot="table-row"]')
    .first();
  await expect(firstSystemLogRow).toBeVisible();

  const eventDescription = firstSystemLogRow
    .locator('[data-slot="table-cell"]')
    .first()
    .locator('p')
    .nth(1);
  await expect(eventDescription).toHaveCSS('overflow-x', 'hidden');
  await expect(eventDescription).toHaveCSS('text-overflow', 'ellipsis');
  await expect(eventDescription).toHaveCSS('white-space', 'nowrap');
});

test('两类令牌可编辑功能组且访问令牌可编辑过期策略', async ({ page }) => {
  const tokenPages = [
    {
      route: '/access-tokens',
      showsExpiration: true,
      editButtonName: '编辑令牌',
      dialogHeading: '编辑访问令牌',
    },
    {
      route: '/device-tokens',
      showsExpiration: false,
      editButtonName: '编辑功能组',
      dialogHeading: '编辑令牌功能组',
    },
  ];
  for (const tokenPage of tokenPages) {
    await page.goto(tokenPage.route);
    await expect(
      page.getByRole('columnheader', { name: '过期时间' }),
    ).toHaveCount(tokenPage.showsExpiration ? 1 : 0);
    await expect(
      page.getByRole('columnheader', { name: '调用次数' }),
    ).toHaveCount(tokenPage.showsExpiration ? 1 : 0);
    await page
      .getByRole('button', { name: tokenPage.editButtonName })
      .first()
      .click();
    const editDialog = page.getByRole('dialog');
    await expect(
      editDialog.getByRole('heading', { name: tokenPage.dialogHeading }),
    ).toBeVisible();
    await expect(editDialog.getByLabel('最大调用次数')).toHaveCount(
      tokenPage.showsExpiration ? 1 : 0,
    );
    await expect(editDialog.getByRole('checkbox').first()).toBeVisible();
    const selectedProjectCount = await editDialog
      .getByRole('checkbox', { checked: true })
      .count();
    expect(selectedProjectCount).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(editDialog).toBeHidden();
  }
});

test('非安全上下文缺少 Clipboard API 时仍可复制令牌', async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on('pageerror', (runtimeError) => runtimeErrors.push(runtimeError));
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => undefined,
    });
  });
  await page.goto('/access-tokens');
  await page.getByRole('button', { name: '复制令牌' }).first().click();
  await expect(page.getByText('令牌已复制')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('请求日志详情从右侧打开且 AppAudit Step 默认收起', async ({ page }) => {
  await page.goto('/request-logs');
  const detailButtons = page.getByRole('button', { name: '查看请求详情' });
  await expect(detailButtons.first()).toBeVisible();
  await detailButtons.first().click();
  const detailSheet = page.locator(
    '[data-slot="sheet-content"][data-side="right"]',
  );
  await expect(detailSheet).toBeVisible();
  await expect(
    detailSheet.getByRole('heading', { name: '请求详情' }),
  ).toBeVisible();
  await expect(detailSheet.getByText('设备 AppAudit Step')).toBeVisible();

  const auditSteps = detailSheet.locator('details');
  if ((await auditSteps.count()) > 0) {
    await expect(auditSteps.first()).not.toHaveAttribute('open', '');
    await auditSteps.first().locator('summary').click();
    await expect(auditSteps.first()).toHaveAttribute('open', '');
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
    navigationDialog.getByText('R2RPC', { exact: true }),
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

  // 用户列表已改为服务端分页，请求恒带 page/pageSize，拦截模式必须覆盖 query string
  await page.route('**/users?*', async (route) => {
    markUsersRequestStarted?.();
    await usersRequestCanContinue;
    await route.continue();
  });

  await page.getByRole('link', { name: '后台账号' }).click();
  await usersRequestStarted;
  await expect(page.getByRole('heading', { name: '运行概览' })).toBeVisible();
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
