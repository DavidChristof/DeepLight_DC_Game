\version "2.26.0"
\header { title = "火光之外" subtitle = "白昼民谣 · Deep-Light" composer = "OpenAI / Codex" tagline = ##f }

global = { \key a \major \time 4/4 \tempo 4 = 92 }
introChords = \chordmode { a1 | e | fis:m | d | a | e | d | e | }
songChords = \chordmode {
  a1 | e | fis:m | d | a | e | d | e |
  a | cis:m | fis:m | d | a | e | d | e |
  fis:m | d | a | e | fis:m | d | e | e |
  a | e | fis:m | d | a | e | d | a |
}

% 分解音型使用 fixed：每个音的八度明确写出，不会因重复展开而逐段下沉。
introGuitar = \fixed c' {
  \global \repeat unfold 2 {
    a8 e' cis' e a e' cis' e | e8 b' gis' b e b' gis' b |
    fis8 cis' a' cis fis cis' a' cis | d8 a' fis' a d a' fis' a |
  }
}
guitar = \fixed c' {
  \global \repeat unfold 4 {
    a8 e' cis' e a e' cis' e | e8 b' gis' b e b' gis' b |
    fis8 cis' a' cis fis cis' a' cis | d8 a' fis' a d a' fis' a |
    a8 e' cis' e a e' cis' e | e8 b' gis' b e b' gis' b |
    d8 a' fis' a d a' fis' a | e8 b' gis' b e b' gis' b |
  }
}

bass = \fixed c {
  \global
  a1 | e | fis | d | a | e | d | e |
  \repeat unfold 2 {
    a2 e' | fis,2 cis' | d,2 a' | e,2 b' |
    a2 e' | cis,2 gis' | d,2 a' | e,2 b' |
    fis,2 cis' | d,2 a' | a,2 e' | e,2 b' |
    fis,2 cis' | d,2 a' | e,2 b' | a,1 |
  }
}

melody = \relative c'' {
  \global
  r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 |
  r2 cis4 e | fis2 e4 cis | b2 cis4 e | fis2 e4 r |
  cis4 e fis a | gis2 e4 fis | e2 cis4 b | cis1 |
  cis4 e fis a | b2 a4 fis | e2 fis4 e | cis1 |
  e4 fis a b | cis2 b4 a | fis2 e4 cis | b1 |
  a'4 gis fis e | fis2 e4 cis | b4 cis e fis | e1 |
  cis4 e fis a | b2 a4 fis | e2 cis4 b | a1 |
  cis4 e fis e | cis2 b4 cis | e2 fis4 e | cis1 |
  b4 cis e fis | e2 cis4 b | a2 gis4 fis | a1 |
}

counter = \relative c' {
  \global
  r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 |
  \repeat unfold 2 {
    r1 | r2 a4 cis | d2 cis4 a | b1 |
    r1 | r2 cis4 e | fis2 e4 cis | b1 |
    r1 | r2 cis4 e | fis2 e4 cis | b1 |
    r1 | r2 a4 cis | d2 cis4 a | a1 |
  }
}

\score {
  <<
    \new ChordNames { \set chordChanges = ##t \introChords \songChords }
    \new Staff \with { instrumentName = "Fiddle" } { \melody }
    \new Staff \with { instrumentName = "Guitar" } { \clef "treble_8" \introGuitar \guitar }
    \new Staff \with { instrumentName = "Counter" } { \clef treble \counter }
    \new Staff \with { instrumentName = "Bass" } { \clef bass \bass }
  >>
  \layout { } \midi { }
}
