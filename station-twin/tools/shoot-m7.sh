#!/bin/bash
# Milestone 7: the guided tour beat by beat, the palette, the Sankey, the timeline, both themes.
cd "$(dirname "$0")/.."
O=docs/milestones/m7; mkdir -p $O
B="capture=1&backend=webgl&tier=medium&dock=0"
shot() { timeout 900 node tools/shoot.mjs "$O/$1.png" "$B&$2" 1600 900 | head -c 160; echo; }
shot tour-1-arrival "tour=0&frames=6" &
shot tour-2-day "tour=1&tourRun=1&frames=12" &
shot tour-3-circuit "tour=2&frames=70" &
wait
shot tour-4-agents "tour=3&frames=6" &
shot tour-5-peak "tour=4&tourRun=1&frames=6" &
shot tour-6-n1 "tour=5&tourRun=1&preview=1&frames=12" &
wait
shot tour-7-storm "tour=6&tourRun=1&frames=6" &
shot tour-8-recovery "tour=7&tourRun=1&frames=6&theme=control" &
shot palette "palette=1&frames=4" &
wait
shot sankey "scenario=add_solar,wind_up&sankey=1&frames=4" &
shot control-room "time=18:30&scenario=peak&theme=control&frames=6" &
wait
