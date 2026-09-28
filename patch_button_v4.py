import sys

file_path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\DeckCardItem.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Let's find the start of the block with `style={{ opacity: 0.6`
start_idx = -1
for i, line in enumerate(lines):
    if "style={{ opacity: 0.6, cursor: 'not-allowed' }}" in line:
        start_idx = i - 2
        break

if start_idx != -1:
    end_idx = -1
    for i in range(start_idx, len(lines)):
        if "            )}\n" == lines[i] or "            )}\r\n" == lines[i] or lines[i].strip() == ")}":
            end_idx = i
            break
            
    if end_idx != -1:
        # We found the block
        print(f"Replacing block from {start_idx} to {end_idx}")
        
        # Original text of the span to preserve the inner JS template
        span_line = ""
        for i in range(start_idx, end_idx):
            if "<span>{" in lines[i]:
                span_line = lines[i]
                break
                
        if span_line:
            clean_span = span_line.replace(" (в разработке)", "")
            
            new_block = [
                "            {!deck.is_inbox && !deck.is_global_readonly && (\n",
                "              <button \n",
                "                className=\"dropdown-item\" \n",
                "                onClick={(e) => {\n",
                "                  handleToggleLearning(e);\n",
                "                  setIsMenuOpen(false);\n",
                "                }}\n",
                "              >\n",
                clean_span,
                "              </button>\n",
                "            )}\n"
            ]
            
            # Replace lines in array
            lines = lines[:start_idx] + new_block + lines[end_idx+1:]
            
            with open(file_path, 'w', encoding='utf-8', newline='') as f:
                f.writelines(lines)
            print("Successfully replaced.")
        else:
            print("Could not find span line")
    else:
        print("Could not find end index")
else:
    print("Could not find start index")
