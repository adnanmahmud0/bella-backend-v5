import re
import os
import glob

def fix_id_parsing(content):
    """Fix all instances of req.params.id to use parseInt()"""
    
    # Pattern 1: const { id } = req.params;
    pattern1 = r"const \{ id \} = req\.params;"
    replacement1 = """const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }"""
    content = re.sub(pattern1, replacement1, content)
    
    # Pattern 2: const someId = req.params.id;
    pattern2 = r"const (\w+Id) = req\.params\.id;"
    def replacement2(match):
        var_name = match.group(1)
        return f"""const {var_name} = parseInt(req.params.id);
    if (isNaN({var_name})) {{
      return res.status(400).json({{ success: false, error: 'Invalid ID' }});
    }}"""
    content = re.sub(pattern2, replacement2, content)
    
    return content

# Process all route files
routes_dir = "src/routes"
files = glob.glob(f"{routes_dir}/*.ts")

for filepath in files:
    print(f"Processing {filepath}...")
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    content = fix_id_parsing(content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"  ✅ Fixed {filepath}")
    else:
        print(f"  ⏭️  No changes needed for {filepath}")

print("\n✨ Done!")
