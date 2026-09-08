<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {Plus, Refresh} from '@element-plus/icons-vue'
import {
  createDemoUser,
  deleteDemoUser,
  queryDemoUserById,
  queryDemoUsersPage,
  updateDemoUser,
} from '../api/sqlite-demo'
import type {DemoUser} from '../entities/demo-user'

defineOptions({name: 'sqlite-demo'})

const loading = ref(false)
const users = ref<DemoUser[]>([])
const keyword = ref('')
const editorVisible = ref(false)
const saving = ref(false)
const form = reactive({
  id: undefined as number | undefined,
  name: '',
  age: 18,
  email: '',
})
const pagination = ref({
  page: 1,
  rowsPerPage: 10,
  rowsNumber: 0,
})

const isEditMode = computed(() => Number.isInteger(form.id))

const showError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  ElMessage.error(message)
}

const showSuccess = (message: string) => {
  ElMessage.success(message)
}

const resetForm = () => {
  form.id = undefined
  form.name = ''
  form.age = 18
  form.email = ''
}

const normalizeForm = () => {
  const name = form.name.trim()
  const email = form.email.trim()
  const age = Number(form.age)

  if (!name) throw new Error('姓名不能为空')
  if (!email) throw new Error('邮箱不能为空')
  if (!Number.isFinite(age) || age < 0) throw new Error('年龄必须是大于等于 0 的数字')

  return {
    name,
    email,
    age,
  }
}

const queryUsersPage = async () => {
  return await queryDemoUsersPage({
    page: pagination.value.page,
    pageSize: pagination.value.rowsPerPage,
    keyword: keyword.value,
  })
}

const loadUsers = async () => {
  loading.value = true

  try {
    const pageResult = await queryUsersPage()

    if (pageResult.total > 0 && pageResult.list.length === 0 && pagination.value.page > 1) {
      pagination.value.page -= 1
      const previousPageResult = await queryUsersPage()
      users.value = previousPageResult.list
      pagination.value.rowsNumber = previousPageResult.total
      return
    }

    users.value = pageResult.list
    pagination.value.rowsNumber = pageResult.total
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

const handleSearch = async () => {
  pagination.value.page = 1
  await loadUsers()
}

const handleResetSearch = async () => {
  keyword.value = ''
  pagination.value.page = 1
  await loadUsers()
}

const handlePageChange = async (page: number) => {
  pagination.value.page = page
  await loadUsers()
}

const handlePageSizeChange = async (pageSize: number) => {
  pagination.value.page = 1
  pagination.value.rowsPerPage = pageSize
  await loadUsers()
}

const handleCreate = () => {
  resetForm()
  editorVisible.value = true
}

const handleSubmit = async () => {
  if (saving.value) return

  try {
    const payload = normalizeForm()
    const editing = isEditMode.value
    saving.value = true

    if (form.id !== undefined) {
      const updated = await updateDemoUser({id: form.id, ...payload})
      if (!updated) throw new Error('未找到要更新的数据')
    } else {
      await createDemoUser(payload)
    }

    editorVisible.value = false
    showSuccess(editing ? '更新成功' : '新增成功')
    await loadUsers()
  } catch (error) {
    showError(error)
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row: DemoUser) => {
  try {
    const deleted = await deleteDemoUser(row.id)
    if (!deleted) throw new Error('未找到要删除的数据')

    if (form.id === row.id) {
      resetForm()
    }

    await loadUsers()
    showSuccess('删除成功')
  } catch (error) {
    showError(error)
  }
}

const handleEdit = async (id: number) => {
  try {
    const user = await queryDemoUserById(id)
    if (!user) throw new Error('未找到要编辑的数据')

    form.id = user.id
    form.name = user.name
    form.age = user.age
    form.email = user.email
    editorVisible.value = true
  } catch (error) {
    showError(error)
  }
}

onMounted(async () => {
  await loadUsers()
})
</script>

<template>
  <div class="workspace-page">
    <el-card shadow="never" class="panel">
      <div class="panel-section">
        <div class="header">
          <div>
            <p class="title">SQLite CRUD Demo</p>
          </div>
          <div class="actions">
            <el-button :icon="Refresh" @click="loadUsers">刷新列表</el-button>
            <el-button type="primary" :icon="Plus" @click="handleCreate">新增</el-button>
          </div>
        </div>

        <div class="search-row">
          <el-input
            v-model="keyword"
            clearable
            placeholder="按姓名/邮箱搜索"
            @keyup.enter="handleSearch"
          />
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button type="primary" plain @click="handleResetSearch">清空</el-button>
        </div>

        <el-table v-loading="loading" :data="users" border stripe class="table">
          <el-table-column prop="id" label="ID" width="80" sortable />
          <el-table-column prop="name" label="姓名" min-width="120" />
          <el-table-column prop="age" label="年龄" width="80" />
          <el-table-column prop="email" label="邮箱" min-width="180" />
          <el-table-column prop="createdAt" label="创建时间" min-width="180" />
          <el-table-column prop="updatedAt" label="更新时间" min-width="180" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="props">
              <div class="row-actions">
                <el-button
                  size="small"
                  type="primary"
                  link
                  @click="handleEdit(props.row.id)"
                >
                  编辑
                </el-button>
                <el-popconfirm title="确定删除这条数据吗？" @confirm="handleDelete(props.row)">
                  <template #reference><el-button
                  size="small"
                  type="danger"
                  link
                >
                  删除
                  </el-button></template>
                </el-popconfirm>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.rowsPerPage"
          :page-sizes="[5, 10, 20, 50]"
          :total="pagination.rowsNumber"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="editorVisible"
      append-to-body
      destroy-on-close
      align-center
      :title="isEditMode ? '编辑用户' : '新增用户'"
      width="min(480px, calc(100vw - 32px))"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :show-close="!saving"
    >
      <el-form
        id="sqlite-user-form"
        label-position="top"
        :disabled="saving"
        class="editor-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item label="姓名">
          <el-input v-model="form.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="年龄">
          <el-input-number v-model="form.age" :min="0" placeholder="请输入年龄" controls-position="right" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="editorVisible = false">取消</el-button>
        <el-button type="primary" native-type="submit" form="sqlite-user-form" :loading="saving">
          {{ isEditMode ? '保存' : '新增' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel {
  background: var(--app-surface);
  border-color: var(--app-border);
  border-radius: var(--el-border-radius-base);
  margin: 0 auto;
  min-width: 0;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.editor-form .el-input-number {
  width: 100%;
}

.search-row {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto auto;
  max-width: 560px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.actions > .el-button + .el-button {
  margin-left: 0;
}

.table {
  background: transparent;
}

.row-actions {
  display: flex;
  gap: 4px;
}

:deep(.el-pagination) {
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 640px) {
  .header {
    flex-wrap: wrap;
  }

  .search-row {
    display: flex;
    flex-wrap: wrap;
  }

  .search-row > .el-input {
    flex: 1 1 200px;
  }
}
</style>
