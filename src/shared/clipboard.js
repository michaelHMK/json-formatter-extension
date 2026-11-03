export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const temporary = document.createElement('textarea');
    temporary.value = text;
    document.body.appendChild(temporary);
    temporary.select();
    try {
      document.execCommand('copy');
    } finally {
      temporary.remove();
    }
  }
}
