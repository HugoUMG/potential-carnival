export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        secondary: '#3B82F6',
        accent: '#10B981',
        // ── Marca DinoEnglish Studio (mascota RexLearn) ──────────────────
        // Verde cuerpo · naranja espinas · crema panza · tinta contorno.
        rex: {
          DEFAULT: '#84B84C', // verde cuerpo del dino
          dark: '#5E8E32',    // hover / profundidad
          deep: '#3D5E24',    // texto verde sobre claro
          light: '#EDF3DE',   // fondos suaves / chips
        },
        spike: {
          DEFAULT: '#EE7B30', // naranja de las espinas (acento)
          dark: '#CE6014',
        },
        cream: '#F6F4E9',     // panza / fondo de página
        ink: '#2B2A26',       // contorno / texto principal
      },
      borderRadius: {
        xl: '12px',
      },
    },
  },
  plugins: [],
};
