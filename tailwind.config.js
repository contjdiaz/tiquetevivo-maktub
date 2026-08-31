/** Tailwind config for TiqueteVivo redesign */
export default {
  content: [
    './public/**/*.html',
    './src/**/*.{js,ts}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0B6E4F',
        accent: '#F59E0B'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      }
    }
  },
  plugins: []
}
