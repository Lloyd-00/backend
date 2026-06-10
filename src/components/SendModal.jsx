import { useState } from "react";
import styles from "./SendModal.module.css";

function SendModal({ groups, users, onClose, onQueueSend }) {
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [deliveryMethod, setDeliveryMethod] = useState("both");
  const getUserKey = (user) => user.id || user.email || user.mobile;

  const filteredUsers = selectedGroup
    ? users.filter((u) => u.group_id === selectedGroup)
    : users;

  const allSelected =
    filteredUsers.length > 0 &&
    filteredUsers.every((u) =>
      selectedUsers.some((su) => getUserKey(su) === getUserKey(u)),
    );

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(filteredUsers);
    }
  };

  const toggleUser = (user) => {
    setSelectedUsers((prev) =>
      prev.some((u) => getUserKey(u) === getUserKey(user))
        ? prev.filter((u) => getUserKey(u) !== getUserKey(user))
        : [...prev, user],
    );
  };

  const handleSend = () => {
    if (selectedUsers.length === 0) {
      alert("No users selected!");
      return;
    }

    onQueueSend({
      channel: deliveryMethod,
      users: selectedUsers,
    });
    onClose();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2>Select Users</h2>

        <div className={styles.radioGroup}>
          <label>
            <input
              type="radio"
              name="deliveryMethod"
              value="sms"
              checked={deliveryMethod === "sms"}
              onChange={(event) => setDeliveryMethod(event.target.value)}
            />
            SMS
          </label>
          <label>
            <input
              type="radio"
              name="deliveryMethod"
              value="email"
              checked={deliveryMethod === "email"}
              onChange={(event) => setDeliveryMethod(event.target.value)}
            />
            Email
          </label>
          <label>
            <input
              type="radio"
              name="deliveryMethod"
              value="both"
              checked={deliveryMethod === "both"}
              onChange={(event) => setDeliveryMethod(event.target.value)}
            />
            Both
          </label>
        </div>

        <div className={styles.controls}>
          <button
            className={`${styles.button} ${allSelected ? styles.toggled : styles.untoggled}`}
            onClick={toggleSelectAll}
          >
            {allSelected ? "Deselect All" : "Select All"}
          </button>

          <select
            style={{ color: "black" }}
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
          >
            <option key="all" value="">
              All Groups
            </option>

            {groups.map((g, index) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.userList}>
          {filteredUsers.map((u, i) => (
            <div key={u.id} className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={selectedUsers.some((user) => getUserKey(user) === getUserKey(u))}
                onChange={() => toggleUser(u)}
              />
              <span>{u.email || u.mobile || u.username || "Unnamed user"}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className={styles.button} onClick={onClose}>
            Cancel
          </button>

          <button
            className={styles.button}
            onClick={handleSend}
          >
            Send Announcement
          </button>
        </div>
      </div>
    </div>
  );
}

export default SendModal;
