// Everything of the chronicle the map loads only when the owner turned it on under Settings > Map: the canvas of
// shapes and their names, the moving fronts (and their worker), the card in the bar and the front page. Kept out of
// the map's own code, so a map without it fetches none of this.
export { ChronicleCard } from './chronicle-card'
export { ChroniclePage } from './chronicle-page'
export { ChronicleNames, chronicleLook, drawChronicle } from './map-chronicle'
export { onMorph } from './map-chronicle-morph'
