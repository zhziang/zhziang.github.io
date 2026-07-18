const markdownInline = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
  .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+|[\w./?=&%#-]+)\)/g, '<a href="$2">$1</a>');

const renderMarkdown = (source) => {
  const lines = source.replace(/<!--[^]*?-->/g, '').split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let inList = false;
  const flush = () => { if (paragraph.length) output.push(`<p>${markdownInline(paragraph.join(' ')).replace(/&lt;br&gt;/g, '<br>')}</p>`); paragraph = []; };
  const closeList = () => { if (inList) output.push('</ul>'); inList = false; };
  lines.forEach((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);
    if (heading) { flush(); closeList(); const level = heading[1].length; output.push(`<h${level}>${markdownInline(heading[2])}</h${level}>`); }
    else if (/^---+$/.test(line.trim())) { flush(); closeList(); output.push('<hr>'); }
    else if (item) { flush(); if (!inList) { output.push('<ul>'); inList = true; } output.push(`<li>${markdownInline(item[1])}</li>`); }
    else if (!line.trim()) { flush(); closeList(); }
    else paragraph.push(/\s{2}$/.test(line) ? `${line.trim()}<br>` : line.trim());
  });
  flush(); closeList(); return output.join('\n');
};

const article = document.querySelector('#blog-article');
const requestedPost = new URLSearchParams(window.location.search).get('post');

const showError = (message) => {
  article.innerHTML = `<h1>Article not found</h1><p>${message}</p><p><a href="index.html#blogs">Return to all posts</a></p>`;
};

const loadPost = async () => {
  try {
    const indexResponse = await fetch('content/blogs/index.json');
    if (!indexResponse.ok) throw new Error('The blog index could not be loaded.');
    const filenames = await indexResponse.json();
    if (!requestedPost || !filenames.includes(requestedPost)) {
      showError('The requested article is not listed in the blog index.');
      return;
    }
    const postResponse = await fetch(`content/blogs/${requestedPost}`);
    if (!postResponse.ok) throw new Error('The article file could not be loaded.');
    const markdown = await postResponse.text();
    article.innerHTML = renderMarkdown(markdown);
    const title = article.querySelector('h1')?.textContent;
    if (title) document.title = `${title} | Zhang Zi-Ang`;
  } catch (error) {
    showError(error.message);
    console.error(error);
  }
};

document.querySelector('#year').textContent = new Date().getFullYear();
loadPost();
