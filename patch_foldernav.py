import re

path = r'c:\121\Lerne_projekt\tma\app\src\components\deckgrid\FolderTreeNav.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add imports if missing
if "import { useAuthStore }" not in content:
    content = content.replace("import { useLanguageStore } from '../../store/useLanguageStore';", 
                              "import { useLanguageStore } from '../../store/useLanguageStore';\nimport { useAuthStore } from '../../store/useAuthStore';\nimport api from '../../services/api';")

# Add isAdmin
if "const isAdmin =" not in content:
    content = content.replace("const [menuPlacement, setMenuPlacement] = useState('bottom');",
                              "const [menuPlacement, setMenuPlacement] = useState('bottom');\n  const isAdmin = useAuthStore(state => state.userProfile?.is_admin);")

# Add handleTogglePublish
toggle_publish_func = """
  const handleTogglePublish = async (e) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    const newScope = folder.is_global_readonly ? 'private' : 'global_readonly';
    try {
      await api.post(`/collaborative/admin/folders/${folder.id}/access-scope`, { access_scope: newScope });
      showToast(folder.is_global_readonly ? 'Папка скрыта из общего доступа' : 'Папка опубликована', 'success');
      useDeckStore.getState().fetchDecks(true);
    } catch (err) {
      console.error(err);
      showToast('Ошибка публикации', 'error');
    }
  };
"""

if "const handleTogglePublish =" not in content:
    content = content.replace("  const handleDelete = (e) => {", toggle_publish_func + "\n  const handleDelete = (e) => {")

# Add button to dropdown
publish_btn = """
            {isAdmin && (
              <button className="dropdown-item" onClick={handleTogglePublish} style={{ color: '#8b5cf6', fontWeight: 600 }}>
                <span>{folder.is_global_readonly ? '🔐 Скрыть из общего доступа' : '🌍 Опубликовать глобально'}</span>
              </button>
            )}
"""

if "Опубликовать глобально" not in content:
    content = content.replace("""            <button className="dropdown-item" onClick={(e) => {""", publish_btn + """            <button className="dropdown-item" onClick={(e) => {""")

with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("FolderTreeNav.jsx patched")
