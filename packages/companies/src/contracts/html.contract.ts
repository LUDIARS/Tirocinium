export default {
  post: (result: string, html: string, maxChars = 8000): true | string => {
    if (result.length > maxChars) return 'text exceeds requested limit';
    if (html === '<p>A &amp; B</p><script>hidden</script>' && result !== 'A & B') return 'visible text mismatch';
    return true;
  },
};
