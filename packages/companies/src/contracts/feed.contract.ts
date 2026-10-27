export default {
  post: (result: { title: string; link: string }[], xml: string): true | string => {
    if (xml === '<item><title>News</title><link>https://example.com/</link></item>' && (result.length !== 1 || result[0]?.title !== 'News' || result[0]?.link !== 'https://example.com/')) return 'feed mismatch';
    return result.every(item => item.link.length > 0) || 'empty feed link';
  },
};
