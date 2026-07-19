# Academic portfolio template

A responsive, dependency-free personal scholar website designed for GitHub Pages. It includes Home, Research, Publications, CV, and Blogs sections.

## Personalize

1. Replace Zhang Zi-Ang's email, affiliations, and profile links in `index.html`.
2. Replace the sample research, publications, experience, and blog content.
3. Add your CV as `assets/cv.pdf`, then update the CV download link in `index.html`.
4. Replace the temporary online video URL in `index.html` with your own looping 2D turbulence animation. You may use an online MP4 URL or `assets/turbulence.mp4`. The procedural flow field remains as a loading and error fallback.
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

## Generate the ASCII turbulence movie

Install the converter dependencies:

```powershell
python -m pip install -r requirements-ascii.txt
```

Inspect the datasets stored in an HDF5 file:

```powershell
python scripts/h5_to_ascii_video.py snapshots.h5 --list
```

Generate the movie (replace `/vorticity` with the relevant dataset path):

```powershell
python scripts/h5_to_ascii_video.py snapshots.h5 --dataset /vorticity
```

Add a two-second fade to black at the end:

```powershell
python scripts/h5_to_ascii_video.py snapshots.h5 --dataset /vorticity --fade-out 2
```

Apply matching two-second field fades at both ends:

```powershell
python scripts/h5_to_ascii_video.py snapshots.h5 --dataset /vorticity --fade-in 2 --fade-out 2
```

The fades scale vorticity magnitude before ASCII rendering. Glyphs therefore transition through the same magnitude mapping used by the rest of the movie instead of merely becoming transparent.

The default output is `assets/turbulence-ascii.mp4`. The website automatically prefers this pre-rendered movie and falls back to the online Pexels video if the file is absent. Run `python scripts/h5_to_ascii_video.py --help` for frame range, axes, component, FPS, resolution, character density, normalization, and compression options.

By default, ASCII symbol density and four glyph-brightness levels encode vorticity magnitude, while color encodes sign: red for positive values and green for negative values. Pass `--color-mode cyan` to render a single-color style. Use `--gamma` below `1` to brighten weaker structures, and adjust `--high-percentile` to control clipping of the strongest vortices.

After generating the final movie, commit `assets/turbulence-ascii.mp4` with the website files and push it to GitHub Pages. Keep the source HDF5 file local; `*.h5` and `*.hdf5` are excluded by `.gitignore` because simulation datasets are typically too large for GitHub.
