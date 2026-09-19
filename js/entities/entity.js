// entities/entity.js —— 通用实体基座（注册表 + 唯一 id）
// 未来拓荒者/建筑/投射物等都可挂到同一实体模型上
let NEXT_ID = 1;

export class Entity {
  constructor(kind, x, y) {
    this.id = NEXT_ID++;
    this.kind = kind;
    this.x = x;         // 连续坐标（tile 单位，格心为 .5）
    this.y = y;
    this.alive = true;  // 置 false 后由所属系统清理
  }
}
