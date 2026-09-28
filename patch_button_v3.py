import sys

file_path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\DeckCardItem.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if "{!deck.is_inbox && !deck.is_global_readonly && (" in line:
        # check next few lines for opacity
        has_opacity = False
        for j in range(i, min(i+5, len(lines))):
            if "opacity: 0.6" in lines[j]:
                has_opacity = True
                break
        
        if has_opacity:
            # We found the start of the block
            new_lines.append("            {!deck.is_inbox && !deck.is_global_readonly && (\n")
            new_lines.append("              <button \n")
            new_lines.append("                className=\"dropdown-item\" \n")
            new_lines.append("                onClick={(e) => {\n")
            new_lines.append("                  handleToggleLearning(e);\n")
            new_lines.append("                  setIsMenuOpen(false);\n")
            new_lines.append("                }}\n")
            new_lines.append("              >\n")
            
            # We need to extract the original string for span, without '(в разработке)'
            # Let's find the span line in the original block
            span_line_index = -1
            for j in range(i, i+15):
                if "<span>{" in lines[j]:
                    span_line_index = j
                    break
            
            if span_line_index != -1:
                original_span = lines[span_line_index]
                clean_span = original_span.replace(" (в разработке)", "").replace(" ( ࠧࠡ⪥)", "")
                new_lines.append(clean_span)
            else:
                # Fallback
                new_lines.append("                <span>{deck.is_learning ? tr(\"? Отключить напоминания (Не учить)\") : tr(\"?? Включить в изучение (Учить)\")}</span>\n")
                
            new_lines.append("              </button>\n")
            new_lines.append("            )}\n")
            
            # Skip the original block
            while i < len(lines) and ")} " not in lines[i] and ")}\n" not in lines[i]:
                i += 1
            i += 1 # skip the closing ")}\n"
            print("Replaced the block!")
            continue
    
    new_lines.append(line)
    i += 1

with open(file_path, 'w', encoding='utf-8', newline='') as f:
    f.writelines(new_lines)
print("Done")
