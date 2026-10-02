"""副本/BOSS 种子数据，来源 副本.md（10人战宝迦兰）。

K（平衡系数）副本.md 里没有，按 plan.md 示例暂取 120→后改为 110，数值待定后再调。
"""

import json

DUNGEON = {
    "name": "战宝迦兰",
    "size": 10,
    "balance_k": 110,
    "drop_equip_count": 3,  # 3+1 掉落的"3"
    "drop_weapon_chance": 0.5,  # 3+1 掉落的"1"
}

# 副本通用材料掉落池：副本内每个 BOSS 击败后都会 roll 一遍
DUNGEON_LOOT = [{"name": "天外陨铁", "min": 1, "max": 1, "chance": 1.0}]

# (seq, BOSS名, A要求装等, B掉落下限, C掉落上限)
BOSSES = [
    (1, "王海银", 130, 128, 133),
    (2, "朱葵", 133, 131, 136),
    (3, "平等", 136, 134, 139),
    (4, "掌火", 136, 134, 139),
    (5, "镇恶", 139, 137, 142),
    (6, "餐风", 142, 140, 145),
    (7, "千手观音", 145, 143, 150),
]

# BOSS 专属掉落表（未列出的 BOSS 无专属）：条目 {"name", "min", "max", "chance"}
BOSS_LOOTS = {
    "王海银": [{"name": "猫眼石", "min": 1, "max": 1, "chance": 0.5}],
}


def build_timeline(boss_ids: list[int]) -> list[dict]:
    """编排副本时间线：每个 BOSS 三步（赶路 → 开战 → 结算），7×3=21 节点。

    时间线可人为自由编排（插入 mob/rest 等），这里只是战宝迦兰的默认编排。"""
    timeline: list[dict] = []
    for boss_id in boss_ids:
        timeline.append({"event": "advance"})
        timeline.append({"event": "fight", "params": {"boss_id": boss_id}})
        timeline.append({"event": "fight_end", "params": {"boss_id": boss_id}})
    return timeline


def timeline_json(boss_ids: list[int]) -> str:
    return json.dumps(build_timeline(boss_ids), ensure_ascii=False)


def loot_json(entries: list[dict]) -> str:
    return json.dumps(entries, ensure_ascii=False)
