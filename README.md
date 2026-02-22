# ASCII Matrix Aura

This project is a web application that converts a 3D model into an ASCII art matrix visualization with a glowing aura effect. It is built using React and Vite.

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

## License
MIT
