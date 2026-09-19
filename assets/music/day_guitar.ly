\version "2.26.0"
\header {
  title = "白昼拾光"
  subtitle = "木吉他民谣 · Deep-Light"
  composer = "OpenAI / Codex"
  tagline = ##f
}

global = { \key a \major \time 4/4 \tempo 4 = 96 }

chordProgression = \chordmode {
  a1 | e | fis:m | d | a | e | d | e |
  a | e | fis:m | d | a | e | d | e |
  cis:m | fis:m | d | a | cis:m | fis:m | e | e |
  a | e | fis:m | d | a | e | d | a |
}

% A 段：轻拨弦，低音与高音交替；每小节型不同，避免机械循环。
guitarA = \fixed c' {
  \global \dynamicUp
  a8 e' cis' e a e' cis' e -\p |
  e8 b' gis' b e b' gis' b |
  fis8 cis' a' cis fis cis' a' cis |
  d8 a' fis' a d a' fis' a |
  <a cis' e'>4 e'8 cis' <a cis' e'>4 e'8 cis' -\mp |
  <e gis' b'>4 b'8 gis' <e gis' b'>4 b'8 gis' |
  <d fis' a'>4 a'8 fis' <d fis' a'>4 a'8 fis' |
  <e gis' b'>2 r8 e'8 fis' gis' |
}

% B 段：切分扫弦，留出反拍空隙；动态推到 f 后立即收回。
guitarB = \fixed c' {
  \global \dynamicUp
  <a cis' e'>8 r <a cis' e'>8 e' <a cis' e'>8 r <a cis' e'> e' -\mf |
  <e gis' b'>8 r <e gis' b'>8 b' <e gis' b'>8 r <e gis' b'> b' |
  <fis a' cis'>8 r <fis a' cis'>8 cis' <fis a' cis'>8 r <fis a' cis'> cis' |
  <d fis' a'>8 r <d fis' a'>8 a' <d fis' a'>8 r <d fis' a'> a' |
  <a cis' e'>8 e' <a cis' e'> e' <a cis' e'> e' <a cis' e'> e' -\< |
  <e gis' b'>8 b' <e gis' b'> b' <e gis' b'> b' <e gis' b'> b' |
  <d fis' a'>8 a' <d fis' a'> a' <d fis' a'> a' <d fis' a'> a' |
  <e gis' b'>4. b'8 <e gis' b'>4 r4 \! |
}

% C 段：开放和弦长音与回声式高音，形成呼吸感。
guitarC = \fixed c' {
  \global \dynamicUp
  <cis e' gis'>2 <cis e' gis'>4 r4 -\f |
  <fis a' cis'>2 <fis a' cis'>4 r4 |
  <d fis' a'>2 <d fis' a'>4 r4 |
  <a cis' e'>2 <a cis' e'>4 r4 |
  <cis e' gis'>4 gis'8 e' <cis e' gis'>4 gis'8 e' -\mf |
  <fis a' cis'>4 cis'8 a' <fis a' cis'>4 cis'8 a' |
  <e gis' b'>4 b'8 gis' <e gis' b'>4 b'8 gis' |
  <e gis' b'>1 |
}

% D 段：回到熟悉的拨弦，但最后两小节收束到 A，适合循环。
guitarD = \fixed c' {
  \global \dynamicUp
  a8 e' cis' e a e' cis' e -\mp |
  e8 b' gis' b e b' gis' b |
  fis8 cis' a' cis fis cis' a' cis |
  d8 a' fis' a d a' fis' a |
  a8 e' cis' e a e' cis' e -\< |
  e8 b' gis' b e b' gis' b |
  d8 a' fis' a d a' fis' a |
  <a cis' e'>1 \! \pp |
}

melody = \relative c'' {
  \global \dynamicUp
  r1 | r1 | r1 | r1 |
  cis4 e fis e -\p | cis2 b4 cis | e2 fis4 e | cis1 |
  cis4 e fis a -\mp | b2 a4 fis | e2 fis4 e | cis1 |
  e4 fis a b | cis2 b4 a | fis2 e4 cis | b1 |
  gis'4 fis e cis -\mf | fis2 e4 cis | d4 e fis a | e1 |
  cis4 e fis a | b2 a4 fis | e2 cis4 b | a1 |
  cis4 e fis e -\> | cis2 b4 cis | e2 fis4 e | cis1 |
  b4 cis e fis | e2 cis4 b | a2 gis4 fis | a1 \! \pp |
}

bass = \fixed c {
  \global \dynamicUp
  a2 e' -\p | fis,2 cis' | d,2 a' | e,2 b' |
  a2 e' | e,2 b' | d,2 a' | e,2 b' |
  a2 e' -\mp | e,2 b' | fis,2 cis' | d,2 a' |
  a2 e' | e,2 b' | d,2 a' | e,2 b' |
  cis2 gis' -\mf | fis,2 cis' | d,2 a' | a,2 e' |
  cis2 gis' | fis,2 cis' | e,1 | e,1 |
  a2 e' -\mp | e,2 b' | fis,2 cis' | d,2 a' |
  a2 e' | e,2 b' | d,2 a' | a,1 \pp |
}

\score {
  <<
    \new ChordNames { \set chordChanges = ##t \chordProgression }
    \new Staff \with { instrumentName = "Melody" } { \melody }
    \new Staff \with { instrumentName = "Guitar" } { \clef "treble_8" \guitarA \guitarB \guitarC \guitarD }
    \new Staff \with { instrumentName = "Bass" } { \clef bass \bass }
  >>
  \layout { }
  \midi { }
}
