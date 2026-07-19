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

const getMarkdownMetadata = (source, fallbackTitle) => {
  const clean = source.replace(/<!--[^]*?-->/g, '');
  const blocks = clean.split(/\r?\n\s*\r?\n/).map((block) => block.trim()).filter(Boolean);
  return {
    title: clean.match(/^#\s+(.+)$/m)?.[1].trim() || fallbackTitle,
    date: clean.match(/^\*([^*]+)\*$/m)?.[1].trim() || '',
    abstract: (blocks.find((block) => !block.startsWith('#') && !/^\*[^*]+\*$/.test(block) && !block.startsWith('-')) || '').replace(/\r?\n/g, ' ')
  };
};

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');
const navLinks = [...document.querySelectorAll('#site-nav a')];

menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});

navLinks.forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
}));

const sections = [...document.querySelectorAll('main section[id]')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${entry.target.id}`));
  });
}, { rootMargin: '-30% 0px -65% 0px' });
sections.forEach((section) => sectionObserver.observe(section));

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.publication').forEach((publication) => {
      publication.classList.toggle('is-hidden', button.dataset.filter !== 'all' && publication.dataset.type !== button.dataset.filter);
    });
  });
});

document.querySelector('#year').textContent = new Date().getFullYear();

const markdownSections = [...document.querySelectorAll('[data-markdown]')];

Promise.all(markdownSections.map(async (section) => {
  try {
    const response = await fetch(section.dataset.markdown);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    section.innerHTML = renderMarkdown(markdown);
  } catch (error) {
    section.innerHTML = `<p class="content-error">Unable to load ${section.dataset.markdown}.</p>`;
    console.error(error);
  }
}));

const blogIndex = document.querySelector('[data-blog-index]');

if (blogIndex) {
  const escapeHtml = (value) => value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  const loadBlogIndex = async () => {
    try {
      const indexResponse = await fetch(blogIndex.dataset.blogIndex);
      if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
      const filenames = await indexResponse.json();
      const posts = await Promise.all(filenames.map(async (filename) => {
        const response = await fetch(`content/blogs/${filename}`);
        if (!response.ok) throw new Error(`Unable to load ${filename}`);
        const markdown = await response.text();
        return { filename, ...getMarkdownMetadata(markdown, filename) };
      }));

      blogIndex.innerHTML = posts.map((post) => `
        <article class="blog-preview">
          <p class="blog-date">${escapeHtml(post.date)}</p>
          <h3><a href="blog.html?post=${encodeURIComponent(post.filename)}">${escapeHtml(post.title)}</a></h3>
          <p>${markdownInline(post.abstract)}</p>
          <a class="read-link" href="blog.html?post=${encodeURIComponent(post.filename)}">Read article →</a>
        </article>
      `).join('');
    } catch (error) {
      blogIndex.innerHTML = '<p class="content-error">Unable to load blog posts.</p>';
      console.error(error);
    }
  };
  loadBlogIndex();
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const vorticityCanvas = document.querySelector('#vorticity-ascii');

if (vorticityCanvas) {
  const loadVorticity = async () => {
    try {
      if (!('DecompressionStream' in window)) throw new Error('This browser does not support gzip streams');
      const response = await fetch('assets/vorticity.vt2d.gz?v=domain-v12');
      if (!response.ok || !response.body) throw new Error(`Vorticity data returned HTTP ${response.status}`);
      const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
      const buffer = await new Response(decompressed).arrayBuffer();
      const view = new DataView(buffer);
      const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
      if (magic !== 'VT2D') throw new Error('Invalid vorticity data signature');
      const headerLength = view.getUint32(4, true);
      const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
      const values = new Int8Array(buffer, 8 + headerLength);
      const expected = metadata.frames * metadata.height * metadata.width;
      if (values.length !== expected || !metadata.periodic) throw new Error('Invalid or non-periodic vorticity payload');
      startVorticityRenderer(metadata, values);
    } catch (error) {
      console.warn('Dynamic vorticity rendering is unavailable; leaving the background blank.', error);
    }
  };

  const startVorticityRenderer = (metadata, values) => {
    const simulation = vorticityCanvas.closest('.hero-simulation');
    const output = vorticityCanvas.getContext('2d');
    const frameSize = metadata.height * metadata.width;
    const cycleDuration = metadata.frames / metadata.fps;
    const intensities = [0.34, 0.52, 0.74, 1];
    const colors = {
      positive: [238, 76, 88],
      negative: [67, 218, 111],
    };
    let lastFrameTime = -Infinity;
    let startTime = null;
    simulation.classList.add('data-ready');

    const draw = (time, staticFrame = false) => {
      if (!staticFrame && time - lastFrameTime < 50) {
        requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = time;
      const bounds = simulation.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      if (vorticityCanvas.width !== Math.round(width * ratio) || vorticityCanvas.height !== Math.round(height * ratio)) {
        vorticityCanvas.width = Math.round(width * ratio);
        vorticityCanvas.height = Math.round(height * ratio);
        output.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      const cellSize = Math.max(10, Math.ceil(height / 58));
      output.font = `${cellSize}px "IBM Plex Mono", monospace`;
      const glyphScaleX = cellSize / Math.max(1, output.measureText('M').width);
      const columns = Math.ceil(width / cellSize);
      const rows = Math.ceil(height / cellSize);
      if (!staticFrame && startTime === null) startTime = time;
      const elapsed = staticFrame
        ? Math.max(metadata.fadeIn, 0)
        : ((time - startTime) / 1000) % cycleDuration;
      const framePosition = elapsed * metadata.fps;
      const frameA = Math.floor(framePosition) % metadata.frames;
      const frameB = (frameA + 1) % metadata.frames;
      const blend = framePosition - Math.floor(framePosition);
      let fieldScale = 1;
      if (metadata.fadeIn > 0 && elapsed < metadata.fadeIn) fieldScale = elapsed / metadata.fadeIn;
      if (metadata.fadeOut > 0 && elapsed > cycleDuration - metadata.fadeOut) {
        fieldScale = Math.min(fieldScale, (cycleDuration - elapsed) / metadata.fadeOut);
      }

      output.fillStyle = '#03080d';
      output.fillRect(0, 0, width, height);
      output.textBaseline = 'middle';
      output.textAlign = 'center';
      output.save();
      output.scale(glyphScaleX, 1);
      for (let y = 0; y < rows; y += 1) {
        const periodicY = ((0.5 + ((y + 0.5) / rows - 0.5) * metadata.viewScale) % 1 + 1) % 1;
        const sourceY = Math.floor(periodicY * metadata.height) % metadata.height;
        for (let x = 0; x < columns; x += 1) {
          // Horizontal distance uses the same scale as vertical distance, preserving square cells.
          const periodicX = ((0.5 + ((x + 0.5) - columns / 2) / rows * metadata.viewScale) % 1 + 1) % 1;
          const sourceX = Math.floor(periodicX * metadata.width) % metadata.width;
          const offset = sourceY * metadata.width + sourceX;
          const valueA = values[frameA * frameSize + offset];
          const valueB = values[frameB * frameSize + offset];
          const value = (valueA + (valueB - valueA) * blend) * fieldScale;
          const magnitude = Math.min(1, Math.abs(value) / 127) ** metadata.gamma;
          const glyph = metadata.ramp[Math.min(metadata.ramp.length - 1, Math.floor(magnitude * metadata.ramp.length))];
          if (glyph === ' ') continue;
          const level = Math.min(3, Math.floor(magnitude * 4));
          const baseColor = value >= 0 ? colors.positive : colors.negative;
          const color = baseColor.map((channel) => Math.round(channel * intensities[level]));
          output.fillStyle = `rgb(${color.join(',')})`;
          output.fillText(glyph, ((x + 0.5) * cellSize) / glyphScaleX, (y + 0.5) * cellSize);
        }
      }
      output.restore();
      if (!staticFrame) requestAnimationFrame(draw);
    };

    if (reduceMotion) draw(0, true);
    else requestAnimationFrame(draw);
  };

  loadVorticity();
}
