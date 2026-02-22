
# Model2ASCII

## Live Demo

Test it out instantly on the web:

[https://model2ascii-website.vercel.app/](https://model2ascii-website.vercel.app/)

You can also deploy your own version to Vercel or any static hosting provider for a live website experience.

This project is a web application that converts a 3D model into an ASCII art matrix visualization with a glowing smoke effect. It is built using React and Vite.

## Features
- Loads a 3D model and renders it as ASCII art
- Animated glowing aura effect
- Fast, interactive, and easy to use

## Getting Started

1. **Install dependencies:**
   ```sh
   npm install
   ```
2. **Run the development server:**
   ```sh
   npm run dev
   ```
3. **Open your browser:**
   Visit [http://localhost:8080/](http://localhost:8080/) to view the app.

## Replacing the 3D Model

To use your own 3D model:
1. Place your `.glb` model file in the `public` directory.
2. Name the file exactly `head.glb`.
3. Reload the app. The new model will be loaded and rendered as ASCII art.

## Project Structure
- `src/` - Source code (React components, styles)
- `public/` - Static assets (place your `head.glb` model here)
- `index.html` - Main HTML file
- `vite.config.ts` - Vite configuration

## Live Demo

Test it out instantly on the web:

[https://model2ascii-website.vercel.app/](https://model2ascii-website.vercel.app/)

You can also deploy your own version to Vercel or any static hosting provider for a live website experience.

## License
MIT
