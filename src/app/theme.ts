import { alpha, createTheme } from '@mui/material/styles'

/** Ink on paper: a white sheet on a warm desk, lit from above. */
export const INK = '#0a1625'
export const PAPER = '#fefffe'          // the sheet; matches the masthead artwork's background
export const DESK = '#f5f3e8'           // page background behind the sheet
export const DESK_GLOW = '#fcfbf6'      // light falling on the desk at the top of the page
export const RULE = alpha(INK, 0.18)    // hairline borders
export const SHEET_SHADOW = '0 10px 30px rgba(40, 32, 16, 0.12)'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: INK },
    text: { primary: INK, secondary: '#5d6672' },
    background: { default: DESK, paper: PAPER },
    divider: RULE,
  },
  shape: { borderRadius: 12 },
  typography: { button: { textTransform: 'none', fontWeight: 600 } },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage: `radial-gradient(ellipse 120% 40% at 50% -10%, ${DESK_GLOW}, transparent 70%)`,
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiButton: { styleOverrides: { root: { borderRadius: 999 } } },
    MuiChip: { styleOverrides: { outlined: { borderColor: RULE } } },
    MuiToggleButton: { styleOverrides: { root: { borderColor: RULE } } },
    MuiOutlinedInput: { styleOverrides: { notchedOutline: { borderColor: RULE } } },
  },
})
