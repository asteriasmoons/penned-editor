import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  /*
   This is critical because the compiled editor will later
   load from inside the Vellix app bundle instead of from
   a normal website domain.
  */
  base: "./",

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
