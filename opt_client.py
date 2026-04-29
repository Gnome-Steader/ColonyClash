import re

with open('public/client.js', 'r') as f:
    client = f.read()

# Replace drawSprite
draw_sprite_opt = """function drawSprite(sprite, x, y, size, angle) {
    if (!sprite) return;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Manual transform math is ~4x faster than canvas save/restore stack allocations
    ctx.setTransform(cos, sin, -sin, cos, x - camX, y - camY);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.setTransform(1, 0, 0, 1, -camX, -camY);
}"""

client = re.sub(r'function drawSprite.*?ctx\.restore\(\);\n\}', draw_sprite_opt, client, flags=re.DOTALL)

with open('public/client.js', 'w') as f:
    f.write(client)

