#!/bin/bash
# Milestone 4 screenshots.
cd "$(dirname "$0")/.."
O=docs/milestones/m4; mkdir -p $O
B="capture=1&backend=webgl&tier=medium&dock=0"
EXP="scenario=wind_up,add_solar,add_gas,imp_n&ops=gen:GAS:180,demand:LD_TOWN:200,advance:1800"
NET="view=300,0,-600,-1800,3400,4200"
shot() { timeout 900 node tools/shoot.mjs "$O/$1.png" "$B&$2" 1600 900 | head -c 300; echo; }
shot 01-network-physical "frames=6&$NET" &
shot 02-network-flow-import "frames=12&lens=flow&$NET" &
shot 03-network-flow-export "frames=12&lens=flow&$EXP&$NET" &
wait
shot 04-yard-flow-import "frames=12&lens=flow&view=-150,6,-30,-330,95,-170" &
shot 05-yard-flow-export "frames=12&lens=flow&$EXP&view=-150,6,-30,-330,95,-170" &
shot 06-thermography "frames=12&lens=flow&scenario=peak&time=18:30&view=-98,4,-28,-60,24,-70" &
wait
shot 07-windfarm "frames=8&scenario=wind_up&view=1200,60,-1500,600,180,-700" &
shot 08-solar-battery "frames=8&scenario=add_solar,add_bess&ops=advance:60&view=560,4,180,90,170,-330" &
shot 09-town-night "frames=8&time=21:30&theme=control&view=-50,10,4050,-600,260,2700" &
wait
shot 10-network-flow-control "frames=12&lens=flow&theme=control&$NET" &
shot 11-gas-plume "frames=40&scenario=add_gas&ops=gen:GAS:180,advance:900&view=-315,20,195,-160,70,340" &
shot 12-border "frames=6&view=-400,0,-2700,600,1400,-600" &
wait
shot 13-lough "frames=6&view=-1450,0,1250,-700,500,600" &
shot 14-industrial "frames=6&view=-490,5,670,-60,160,280" &
wait
