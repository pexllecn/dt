import type { Color, Node, UniformNode, Vector2, Vector3 } from 'three/webgpu';

/** Short aliases for TSL node types used across materials. */
export type N<T extends string> = Node<T>;
export type FloatU = UniformNode<'float', number>;
export type Vec2U = UniformNode<'vec2', Vector2>;
export type Vec3U = UniformNode<'vec3', Vector3>;
export type ColorU = UniformNode<'color', Color>;
