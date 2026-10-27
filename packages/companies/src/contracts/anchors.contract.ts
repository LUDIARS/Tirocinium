export default {
  post: (result: { href: string; text: string }[], html: string): true | string => {
    if (html === '<a href="/about"><b>About</b></a>' && JSON.stringify(result) !== JSON.stringify([{ href: '/about', text: 'About' }])) return 'anchor mismatch';
    return result.every(a => a.href.length > 0) || 'empty href';
  },
};
