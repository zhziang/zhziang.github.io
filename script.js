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

const flowCanvas = document.querySelector('#flow-field');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const turbulenceVideo = document.querySelector('#turbulence-video');
const asciiVideo = document.querySelector('#ascii-video');

if (turbulenceVideo) {
  let asciiVideoStarted = false;
  const startAsciiVideo = () => {
    if (!asciiVideo || asciiVideoStarted || reduceMotion) return;
    asciiVideoStarted = true;
    const simulation = turbulenceVideo.closest('.hero-simulation');
    const output = asciiVideo.getContext('2d');
    const sample = document.createElement('canvas');
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    const ramp = ' .:-=+*#%@';
    let lastFrame = 0;

    const renderAsciiFrame = (time) => {
      if (time - lastFrame < 83) {
        requestAnimationFrame(renderAsciiFrame);
        return;
      }
      lastFrame = time;
      const bounds = simulation.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const columns = Math.max(60, Math.min(140, Math.round(bounds.width / 9)));
      const rows = Math.max(32, Math.round(bounds.height / 12));
      if (asciiVideo.width !== Math.round(bounds.width * ratio) || asciiVideo.height !== Math.round(bounds.height * ratio)) {
        asciiVideo.width = Math.round(bounds.width * ratio);
        asciiVideo.height = Math.round(bounds.height * ratio);
        output.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      sample.width = columns;
      sample.height = rows;

      const videoRatio = turbulenceVideo.videoWidth / turbulenceVideo.videoHeight;
      const sampleRatio = columns / rows;
      let sourceWidth = turbulenceVideo.videoWidth;
      let sourceHeight = turbulenceVideo.videoHeight;
      let sourceX = 0;
      let sourceY = 0;
      if (videoRatio > sampleRatio) {
        sourceWidth = turbulenceVideo.videoHeight * sampleRatio;
        sourceX = (turbulenceVideo.videoWidth - sourceWidth) / 2;
      } else {
        sourceHeight = turbulenceVideo.videoWidth / sampleRatio;
        sourceY = (turbulenceVideo.videoHeight - sourceHeight) / 2;
      }

      try {
        sampleContext.drawImage(turbulenceVideo, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, columns, rows);
        const pixels = sampleContext.getImageData(0, 0, columns, rows).data;
        const cellWidth = bounds.width / columns;
        const cellHeight = bounds.height / rows;
        output.fillStyle = '#03080d';
        output.fillRect(0, 0, bounds.width, bounds.height);
        output.font = `${Math.ceil(cellHeight * 1.05)}px "IBM Plex Mono", monospace`;
        output.textAlign = 'center';
        output.textBaseline = 'middle';
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < columns; x += 1) {
            const index = (y * columns + x) * 4;
            const brightness = (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) / 255;
            const character = ramp[Math.min(ramp.length - 1, Math.floor(brightness * ramp.length))];
            output.fillStyle = `rgba(53, 189, 245, ${0.18 + brightness * 0.72})`;
            output.fillText(character, (x + 0.5) * cellWidth, (y + 0.5) * cellHeight);
          }
        }
      } catch (error) {
        simulation.classList.add('ascii-failed');
        console.warn('ASCII video rendering is unavailable; showing the source video.', error);
        return;
      }
      requestAnimationFrame(renderAsciiFrame);
    };
    requestAnimationFrame(renderAsciiFrame);
  };

  const activateTurbulenceVideo = () => {
    const simulation = turbulenceVideo.closest('.hero-simulation');
    const isPreRenderedAscii = turbulenceVideo.currentSrc.includes('turbulence-ascii.mp4');
    simulation.classList.add('video-ready');
    simulation.classList.toggle('pre-rendered-ascii', isPreRenderedAscii);
    turbulenceVideo.play().catch(() => {});
    if (!isPreRenderedAscii) startAsciiVideo();
  };
  turbulenceVideo.addEventListener('canplay', activateTurbulenceVideo);
  if (turbulenceVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) activateTurbulenceVideo();
}

if (flowCanvas && !reduceMotion) {
  const context = flowCanvas.getContext('2d');
  const particles = Array.from({ length: 74 }, () => ({ x: Math.random(), y: Math.random(), age: Math.random() * 180 }));
  let width = 0;
  let height = 0;
  let animationFrame;

  const resizeFlow = () => {
    const bounds = flowCanvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = bounds.width;
    height = bounds.height;
    flowCanvas.width = Math.round(width * ratio);
    flowCanvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const resetParticle = (particle, randomX = false) => {
    particle.x = randomX ? Math.random() : -0.02;
    particle.y = Math.random();
    particle.age = 0;
  };

  const animateFlow = (time) => {
    context.fillStyle = 'rgba(16, 46, 53, 0.045)';
    context.fillRect(0, 0, width, height);
    context.lineWidth = 0.8;
    context.strokeStyle = 'rgba(195, 235, 225, 0.38)';
    particles.forEach((particle) => {
      const previousX = particle.x;
      const previousY = particle.y;
      const swirl = Math.sin(particle.x * 13 + time * 0.00032) * Math.cos(particle.y * 9 - time * 0.0002);
      particle.x += 0.0018 + 0.0008 * Math.cos(particle.y * 11);
      particle.y += swirl * 0.0012;
      particle.age += 1;
      context.beginPath();
      context.moveTo(previousX * width, previousY * height);
      context.lineTo(particle.x * width, particle.y * height);
      context.stroke();
      if (particle.x > 1.02 || particle.y < -0.05 || particle.y > 1.05 || particle.age > 420) resetParticle(particle);
    });
    animationFrame = requestAnimationFrame(animateFlow);
  };

  resizeFlow();
  particles.forEach((particle) => resetParticle(particle, true));
  animationFrame = requestAnimationFrame(animateFlow);
  window.addEventListener('resize', resizeFlow);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(animationFrame);
    else animationFrame = requestAnimationFrame(animateFlow);
  });
}
