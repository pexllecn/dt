#!/bin/bash
# Milestone 8 screenshot matrix: 20 scenario states x 2 themes x 3 lenses = 120 images (WebGL2).
cd "$(dirname "$0")/.."
O=docs/milestones/m8/matrix; mkdir -p $O
B="capture=1&backend=webgl&tier=medium&dock=0"
declare -A S=(
  [01-baseline]="" [02-new-connection]="scenario=ie_estate&ops=advance:600" [03-ni-growth]="scenario=ni_estate&ops=advance:600"
  [04-industrial]="scenario=ind_exp&ops=advance:600" [05-solar]="scenario=add_solar&ops=advance:60" [06-battery]="scenario=add_bess&ops=battery:100,advance:300"
  [07-gas]="scenario=add_gas&ops=gen:GAS:180,advance:1200" [08-wind-surge]="scenario=wind_up&ops=advance:1800" [09-wind-lull]="scenario=wind_dn&ops=advance:1800"
  [10-sunset]="time=18:25" [11-import-north]="scenario=imp_n&ops=advance:900" [12-export-south]="scenario=exp_s&ops=advance:900"
  [13-transfers-off]="scenario=imp_n,nbr_off&ops=advance:900" [14-evening-peak]="time=17:00&scenario=peak&ops=advance:1800" [15-system-split]="scenario=split&ops=advance:120"
  [16-loss-of-t1]="scenario=n1&ops=advance:600" [17-bus-fault]="scenario=busfault&ops=advance:120" [18-pump-failure]="scenario=cool_fail&ops=advance:3900"
  [19-storm]="scenario=storm&ops=advance:2460" [20-export]="scenario=wind_up,add_solar,add_gas,imp_n&ops=gen:GAS:180,demand:LD_TOWN:200,advance:1800"
)
jobs=0
for k in $(printf '%s\n' "${!S[@]}" | sort); do
  for th in daylight control; do
    for ln in physical flow circuit; do
      f="$O/$k-$th-$ln.png"
      [ -f "$f" ] && continue
      q="${S[$k]}"; [ -n "$q" ] && q="&$q"
      t=""; [ $th = control ] && t="&theme=control"
      fr="frames=8"; [ $ln = circuit ] && fr="frames=70"
      timeout 900 node tools/shoot.mjs "$f" "$B$q$t&lens=$ln&$fr" 1600 900 > /dev/null 2>&1 &
      jobs=$((jobs+1)); if (( jobs % 3 == 0 )); then wait; fi
    done
  done
done
wait
ls $O | wc -l
node tools/jpeg.mjs "$O/../matrix-jpg" $O/*.png  # the repository keeps the JPEG versions
