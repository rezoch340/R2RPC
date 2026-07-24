function copyWithHiddenTextArea(value: string): boolean {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof document.execCommand !== 'function'
  ) {
    return false;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.inset = '0 auto auto -9999px';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textArea.remove();
  }
}

export async function copyTextToClipboard(value: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 非安全上下文或浏览器拒绝权限时继续使用兼容复制。
    }
  }

  if (!copyWithHiddenTextArea(value)) {
    throw new Error('当前浏览器不支持自动复制');
  }
}
