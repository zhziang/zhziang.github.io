# Academic portfolio template

A responsive, dependency-free personal scholar website designed for GitHub Pages. It includes Home, Research, Publications, CV, and Blogs sections.

## Personalize

1. Replace Zhang Zi-Ang's email, affiliations, and profile links in `index.html`.
2. Replace the sample research, publications, experience, and blog content.
3. Add your CV as `assets/cv.pdf`, then update the CV download link in `index.html`.
4. Generate `assets/vorticity.vt2d.gz` from your HDF5 snapshots using the workflow below.
5. Update the page title and meta description.

## Publish on GitHub Pages

1. Create a public repository named `yourusername.github.io`.
2. Push these files to the repository's `main` branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**, then choose `main` and `/ (root)`.
5. Visit `https://yourusername.github.io` after GitHub finishes deployment.

No build command is required. Use a local HTTP server to preview the site.

## Edit site content

Research, publications, CV, and blog content live in separate Markdown files:

- `content/research.md`
- `content/publications.md`
- `content/cv.md`
- `content/blogs/` — one Markdown file per blog post

Edit those files using standard Markdown. The page loads them automatically; preview through the local server rather than opening `index.html` directly because browsers block `fetch()` for local files.

### Add a blog post

1. Create a Markdown file inside `content/blogs/`.
2. Use a level-one heading for the title, an italic line for the date, and the first regular paragraph for the abstract.
3. Add the filename to `content/blogs/index.json`.

The Home page extracts the title and abstract automatically. Clicking the title opens the complete Markdown article on `blog.html`.

## Generate the dynamic ASCII turbulence data

Install the converter dependencies:

```powershell
python -m pip install -r requirements-ascii.txt
```

Inspect the datasets stored in an HDF5 file:

```powershell
python scripts/h5_to_vorticity_data.py snapshots.h5 --list
```

Compress the vorticity snapshots (adjust the time axis and stride for your file):

```powershell
python scripts/h5_to_vorticity_data.py snapshots.h5 --dataset vorticity --time-axis 2
```

The default output is `assets/vorticity.vt2d.gz`. It contains gzip-compressed, signed 8-bit snapshots and playback metadata, not rendered pixels. The browser decompresses it, interpolates adjacent snapshots, and renders the ASCII field at the current screen resolution.

The renderer uses periodic modulo indexing, allowing the square simulation domain to continue seamlessly across viewport boundaries. `--view-scale` controls the visible fraction of the domain; the default `1.0` shows one complete periodic domain vertically and continues it horizontally on wider viewports. ASCII glyphs occupy equal square cells, density and four brightness levels encode magnitude, and red or green encodes vorticity sign. Fade-in and fade-out scale the field magnitude before glyph selection.

Run `python scripts/h5_to_vorticity_data.py --help` for frame range, grid resolution, FPS, normalization percentile, gamma, and fade settings. Commit the generated `.vt2d.gz` asset, but keep the source HDF5 local; `*.h5` and `*.hdf5` are excluded by `.gitignore` because simulation datasets are typically too large for GitHub.
