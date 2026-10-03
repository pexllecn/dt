#!/bin/bash
# Milestone 5: the fold at ten points in each direction, both themes, and states.
cd "$(dirname "$0")/.."
O=docs/milestones/m5; mkdir -p $O/fold
B="capture=1&backend=webgl&tier=medium&dock=0&select=T1"
shot() { timeout 900 node tools/shoot.mjs "$O/$1.png" "$B&$2" 1600 900 | head -c 160; echo; }
# Forward: frames at 1/30 s; the fold takes 2.2 s (66 frames). Ten points.
i=0
for f in 1 8 15 22 29 36 43 50 58 66; do
  i=$((i+1)); shot "fold/forward-$(printf %02d $i)" "lens=circuit&frames=$f" &
  if (( i % 3 == 0 )); then wait; fi
done
wait
# Back: fold fully, then return to Physical.
i=0
for f in 1 8 15 22 29 36 43 50 58 66; do
  i=$((i+1)); shot "fold/back-$(printf %02d $i)" "lens=circuit&frames=70&then=physical&thenFrames=$f" &
  if (( i % 3 == 0 )); then wait; fi
done
wait
shot circuit-daylight "lens=circuit&frames=70" &
shot circuit-control "lens=circuit&frames=70&theme=control" &
shot circuit-n1 "lens=circuit&frames=70&scenario=n1&ops=advance:60" &
wait
shot circuit-busfault "lens=circuit&frames=70&scenario=busfault&ops=advance:60" &
shot circuit-built "lens=circuit&frames=70&scenario=add_solar,add_bess,add_gas,ie_estate&ops=advance:600" &
shot circuit-interrupted "lens=circuit&frames=30&then=physical&thenFrames=12" &
wait
