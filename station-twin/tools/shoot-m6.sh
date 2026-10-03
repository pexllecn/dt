#!/bin/bash
# Milestone 6: agents, coordinator, fan of futures, ghost preview, approval, tracking, audit, early catch.
cd "$(dirname "$0")/.."
O=docs/milestones/m6; mkdir -p $O
B="capture=1&backend=webgl&tier=medium&dock=0"
shot() { timeout 900 node tools/shoot.mjs "$O/$1.png" "$B&$2" 1600 900 | head -c 160; echo; }
shot n1-recommendation "scenario=n1&ops=advance:300&frames=6" &
shot n1-preview "scenario=n1&ops=advance:300&preview=1&frames=12" &
shot n1-tracking "scenario=n1&ops=advance:300,approve:1,advance:1800&frames=6" &
wait
shot peak-screen "time=17:00&scenario=peak&ops=advance:1500&frames=6&theme=control" &
shot early-catch "scenario=cool_fail&ops=advance:4200&frames=6&select=T1" &
shot busfault-blocked "scenario=busfault&ops=advance:120&frames=6&lens=circuit&frames=70" &
wait
shot audit "scenario=n1&ops=advance:300,approve:1,advance:600&audit=1&frames=4" &
shot storm-wind "scenario=storm&ops=advance:900&frames=6&view=380,40,-1450,-300,260,-50" &
shot markers "scenario=n1&ops=advance:240&frames=8&view=-60,6,20,-250,90,160" &
wait
